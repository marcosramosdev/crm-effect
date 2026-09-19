"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2, PowerOff, Power } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The account's lifecycle: its name, its owner's password, and whether
// it is in service (admin-console spec.md). Nothing here deletes an
// account — deactivation is reversible and keeps every row
// ("Nothing offers permanent deletion").
//
// The reissued password only ever lives in this component's state. The
// server never sends one back, exactly like the provisioning form.
export function AccountLifecycle({
  accountId,
  name,
  deactivatedAt,
  waitingConversions,
}: {
  accountId: string;
  name: string;
  deactivatedAt: string | null;
  /** Conversions that deactivating will cancel (design.md D4). */
  waitingConversions: number;
}) {
  const t = useTranslations("AdminConsole.lifecycle");
  const router = useRouter();

  const [newName, setNewName] = useState(name);
  const [password, setPassword] = useState("");
  const [issuedPassword, setIssuedPassword] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"name" | "password" | "state" | null>(null);

  const isDeactivated = Boolean(deactivatedAt);

  async function send(
    path: string,
    body: unknown,
    which: "name" | "password" | "state",
  ): Promise<Record<string, unknown> | null> {
    setBusy(which);
    try {
      const res = await fetch(path, {
        method: which === "password" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        toast.error((json.error as string) ?? t("failed"));
        return null;
      }
      return json;
    } catch {
      toast.error(t("networkError"));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function rename() {
    const json = await send(`/api/admin/accounts/${accountId}`, { name: newName }, "name");
    if (!json) return;
    toast.success(t("renamed"));
    router.refresh();
  }

  async function reissuePassword() {
    const json = await send(
      `/api/admin/accounts/${accountId}/password`,
      { password },
      "password",
    );
    if (!json) return;
    setIssuedPassword(password);
    setPassword("");
    toast.success(t("passwordReissued"));
  }

  async function setDeactivated(next: boolean) {
    const json = await send(
      `/api/admin/accounts/${accountId}`,
      { deactivated: next },
      "state",
    );
    if (!json) return;
    if (json.warning) toast.warning(json.warning as string);
    setConfirming(false);
    setConfirmName("");
    toast.success(next ? t("deactivated") : t("reactivated"));
    router.refresh();
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copied"));
    } catch {
      toast.error(t("clipboardBlocked"));
    }
  }

  return (
    <div className="space-y-6">
      {/* Name */}
      <div className="space-y-2">
        <Label className="text-foreground">{t("nameLabel")}</Label>
        <div className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button
            type="button"
            onClick={rename}
            disabled={busy !== null || !newName.trim() || newName.trim() === name}
            className="shrink-0"
          >
            {busy === "name" ? <Loader2 className="size-4 animate-spin" /> : t("save")}
          </Button>
        </div>
      </div>

      {/* Password */}
      <div className="space-y-2">
        <Label className="text-foreground">{t("passwordLabel")}</Label>
        <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
        <div className="flex gap-2">
          <Input
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("passwordPlaceholder")}
          />
          <Button
            type="button"
            onClick={reissuePassword}
            disabled={busy !== null || password.length === 0}
            className="shrink-0"
          >
            {busy === "password" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t("reissue")
            )}
          </Button>
        </div>
        {issuedPassword && (
          <div className="border-border bg-muted flex items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-foreground flex-1 font-mono text-xs break-all">
              {issuedPassword}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(issuedPassword)}
            >
              <Copy className="size-4" />
              {t("copy")}
            </Button>
          </div>
        )}
      </div>

      {/* In service */}
      <div className="border-border space-y-3 rounded-md border px-3 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">
            {isDeactivated ? t("deactivatedTitle") : t("activeTitle")}
          </p>
          <p className="text-muted-foreground text-xs">
            {isDeactivated
              ? t("deactivatedDesc", {
                  date: new Date(deactivatedAt as string).toLocaleString(),
                })
              : t("activeDesc")}
          </p>
        </div>

        {isDeactivated ? (
          <Button
            type="button"
            onClick={() => setDeactivated(false)}
            disabled={busy !== null}
          >
            {busy === "state" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Power className="size-4" />
            )}
            {t("reactivate")}
          </Button>
        ) : confirming ? (
          // Nothing is written until the operator types the account's
          // own name back ("Deactivation is confirmed before it
          // applies"), and the cancellation of waiting conversions is
          // stated here rather than discovered afterwards.
          <div className="space-y-2">
            <p className="text-destructive text-xs">
              {t("confirmPrompt", { name })}
            </p>
            <p className="text-destructive text-xs">{t("confirmConnection")}</p>
            {waitingConversions > 0 && (
              <p className="text-destructive text-xs">
                {t("confirmConversions", { count: waitingConversions })}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={name}
              />
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeactivated(true)}
                disabled={busy !== null || confirmName.trim() !== name}
                className="shrink-0"
              >
                {busy === "state" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  t("confirmDeactivate")
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirming(false);
                  setConfirmName("");
                }}
                className="shrink-0"
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
          >
            <PowerOff className="size-4" />
            {t("deactivate")}
          </Button>
        )}
      </div>
    </div>
  );
}
