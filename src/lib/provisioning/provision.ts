/**
 * The provisioning orchestrator (client-provisioning design.md D1/D2).
 *
 * `auth.admin.createUser` fires the existing `handle_new_user` trigger
 * (migration 017), which creates the `accounts` row and the owner
 * `profiles` row. This module adjusts what that trigger built rather
 * than inserting those rows itself — the trigger is the only code
 * path that creates an account today.
 *
 * Steps run in order, riskiest (third-party) call last:
 *
 *   1. auth.admin.createUser (confirmed)
 *   2. read profiles back — fail if the trigger's bootstrap didn't
 *      land (it swallows its own failures as a WARNING)
 *   3. update accounts (name, Meta credentials)
 *   4. seed pipeline + stages from the specialty template
 *   5. insert ai_configs (persona, auto-reply off, drafts on)
 *   6. provisionInstance() — the UAZAPI call
 *   7. point whatsapp_config's inbound defaults at the seeded pipeline
 *
 * On any failure after step 1, roll back: delete `accounts` first,
 * then the auth user (accounts.owner_user_id is ON DELETE RESTRICT).
 * If the rollback itself fails, the thrown error carries exactly
 * what survived instead of reporting a clean failure.
 */

import { provisionInstance } from "@/lib/whatsapp/instance";
import { encrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "./admin-client";
import { SPECIALTY_TEMPLATES, type SpecialtyKey } from "./templates";

export interface ProvisionInput {
  clientEmail: string;
  clientPassword: string;
  /** Falls back to the e-mail's local part (design.md D6). */
  clinicName?: string;
  /** Falls back to the resolved account name — it only feeds
   *  `user_metadata.full_name`. */
  clientFullName?: string;
  /** Defaults to DEFAULT_SPECIALTY. */
  specialty?: SpecialtyKey;
  /** Defaults to an empty persona, which `ai_configs` accepts. */
  persona?: string;
  /** Optional at provisioning time — an account with no dataset simply
   *  doesn't report conversions until an operator fills it in later via
   *  the /admin edit path (provisioning spec.md). */
  metaDatasetId?: string;
  metaAccessToken?: string;
  /** Diagnostic only — never sent to Meta (admin-console spec.md). */
  metaPageId?: string;
  /** Falls back to the column default when absent. */
  metaEventName?: string;
}

/** Used when the operator picks no specialty (provisioning spec.md,
 *  "Unchosen specialty falls back"). */
export const DEFAULT_SPECIALTY: SpecialtyKey = "dentist";

/**
 * `cliente1@effect.com` -> `cliente1`.
 *
 * An account is never nameless (provisioning spec.md), so a local part
 * carrying no letter or digit — `"..."@x.com`, a leading-dot address —
 * falls back to the whole address rather than to an empty name.
 */
export function accountNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  return /[\p{L}\p{N}]/u.test(local) ? local : email.trim();
}

/** The one place the optional inputs of design.md D6 become concrete, so a
 *  second caller — a seeding script, a test — gets the same defaults. */
export function resolveProvisionInput(input: ProvisionInput): {
  clinicName: string;
  clientFullName: string;
  specialty: SpecialtyKey;
  persona: string;
} {
  const clinicName =
    input.clinicName?.trim() || accountNameFromEmail(input.clientEmail);
  return {
    clinicName,
    clientFullName: input.clientFullName?.trim() || clinicName,
    specialty: input.specialty ?? DEFAULT_SPECIALTY,
    persona: input.persona ?? "",
  };
}

export type ProvisionStep =
  | "create_user"
  | "read_profile"
  | "update_account"
  | "seed_pipeline"
  | "create_ai_config"
  | "provision_gateway"
  | "set_inbound_default";

export interface ProvisionSurvivors {
  authUserId?: string;
  accountId?: string;
}

export class ProvisionError extends Error {
  readonly step: ProvisionStep;
  /** Set only when cleanup itself failed — what's left to remove by hand. */
  readonly survivors?: ProvisionSurvivors;

  constructor(step: ProvisionStep, message: string, survivors?: ProvisionSurvivors) {
    super(message);
    this.name = "ProvisionError";
    this.step = step;
    this.survivors = survivors;
  }
}

async function runStep<T>(
  step: ProvisionStep,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ProvisionError) throw err;
    throw new ProvisionError(
      step,
      err instanceof Error ? err.message : String(err),
    );
  }
}

interface RollbackFailure extends ProvisionSurvivors {
  error: string;
}

/** Delete accounts first (cascades pipelines/stages/ai_configs/whatsapp_config), then the auth user. */
async function rollback(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  authUserId: string,
  accountId: string | null,
): Promise<RollbackFailure | null> {
  if (accountId) {
    const { error } = await db.from("accounts").delete().eq("id", accountId);
    if (error) {
      return { authUserId, accountId, error: error.message };
    }
  }
  const { error } = await db.auth.admin.deleteUser(authUserId);
  if (error) {
    return { authUserId, error: error.message };
  }
  return null;
}

export async function provision(
  input: ProvisionInput,
): Promise<{ email: string }> {
  const db = supabaseAdmin();
  const { clinicName, clientFullName, specialty, persona } =
    resolveProvisionInput(input);

  let authUserId: string | undefined;
  let accountId: string | undefined;

  try {
    authUserId = await runStep("create_user", async () => {
      const { data, error } = await db.auth.admin.createUser({
        email: input.clientEmail,
        password: input.clientPassword,
        email_confirm: true,
        user_metadata: { full_name: clientFullName },
      });
      if (error || !data?.user) {
        throw new Error(
          error?.message ?? "Failed to create the sign-in identity",
        );
      }
      return data.user.id as string;
    });

    accountId = await runStep("read_profile", async () => {
      const { data, error } = await db
        .from("profiles")
        .select("account_id")
        .eq("user_id", authUserId)
        .maybeSingle();
      if (error || !data?.account_id) {
        // handle_new_user (migration 017) swallows its own failures —
        // a missing row/account_id here means bootstrap never landed.
        throw new Error("Account bootstrap did not complete for the new user");
      }
      return data.account_id as string;
    });

    await runStep("update_account", async () => {
      const patch: Record<string, unknown> = { name: clinicName };
      if (input.metaDatasetId) patch.meta_dataset_id = input.metaDatasetId;
      if (input.metaAccessToken) {
        patch.meta_access_token = encrypt(input.metaAccessToken);
      }
      if (input.metaPageId) patch.meta_page_id = input.metaPageId;
      // Validated in the route before anything is created, so a bad
      // name never costs an auth user and a rollback.
      if (input.metaEventName) patch.meta_event_name = input.metaEventName;
      const { error } = await db.from("accounts").update(patch).eq("id", accountId);
      if (error) throw new Error(error.message);
    });

    const { pipelineId, systemStageId } = await runStep(
      "seed_pipeline",
      async () => {
        const { data: pipeline, error: pipelineErr } = await db
          .from("pipelines")
          .insert({
            account_id: accountId,
            user_id: authUserId,
            name: clinicName,
          })
          .select("id")
          .single();
        if (pipelineErr || !pipeline) {
          throw new Error(
            pipelineErr?.message ?? "Failed to create the pipeline",
          );
        }

        const stages = SPECIALTY_TEMPLATES[specialty];
        const { data: inserted, error: stagesErr } = await db
          .from("pipeline_stages")
          .insert(
            stages.map((stage) => ({
              pipeline_id: pipeline.id,
              name: stage.name,
              position: stage.position,
              color: stage.color,
              is_system: stage.isSystem,
            })),
          )
          .select("id, is_system");
        if (stagesErr || !inserted) {
          throw new Error(
            stagesErr?.message ?? "Failed to create the pipeline stages",
          );
        }

        const systemStage = inserted.find(
          (s: { is_system: boolean }) => s.is_system,
        );
        if (!systemStage) {
          throw new Error("Seeded pipeline has no system stage");
        }

        return {
          pipelineId: pipeline.id as string,
          systemStageId: systemStage.id as string,
        };
      },
    );

    await runStep("create_ai_config", async () => {
      const { error } = await db.from("ai_configs").insert({
        account_id: accountId,
        system_prompt: persona,
        auto_reply_enabled: false,
        is_active: true,
      });
      if (error) throw new Error(error.message);
    });

    await runStep("provision_gateway", () =>
      provisionInstance({ db, accountId: accountId!, userId: authUserId! }),
    );

    await runStep("set_inbound_default", async () => {
      const { error } = await db
        .from("whatsapp_config")
        .update({
          inbound_default_pipeline_id: pipelineId,
          inbound_default_stage_id: systemStageId,
        })
        .eq("account_id", accountId);
      if (error) throw new Error(error.message);
    });

    return { email: input.clientEmail };
  } catch (err) {
    const step = err instanceof ProvisionError ? err.step : "create_user";
    const message = err instanceof Error ? err.message : String(err);

    if (!authUserId) {
      // Nothing was created yet — creating the sign-in identity itself
      // is what failed (e.g. duplicate e-mail, weak password).
      throw new ProvisionError(step, message);
    }

    const failure = await rollback(db, authUserId, accountId ?? null);
    if (failure) {
      throw new ProvisionError(
        step,
        `${message} — cleanup could not complete: ${failure.error}`,
        { authUserId: failure.authUserId, accountId: failure.accountId },
      );
    }
    throw new ProvisionError(step, message);
  }
}
