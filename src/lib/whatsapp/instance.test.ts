import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

import {
  provisionInstance,
  startLogin,
  readInstanceStatus,
  disconnectInstance,
  ensureWebhookRegistered,
} from "./instance";

vi.mock("./encryption", () => ({
  // Deterministic, reversible fake so assertions can read the "encrypted"
  // value back without pulling in real AES/ENCRYPTION_KEY plumbing.
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}));

type Row = Record<string, unknown>;

/** Minimal Supabase fake backing a single `whatsapp_config` row. */
function makeDb(initial: Row | null) {
  let row: Row | null = initial;
  const updates: Row[] = [];
  const inserts: Row[] = [];

  const db = {
    from(table: string) {
      if (table !== "whatsapp_config")
        throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
        update: (patch: Row) => ({
          eq: () => {
            row = { ...(row ?? {}), ...patch };
            updates.push(patch);
            return Promise.resolve({ data: null, error: null });
          },
        }),
        insert: (patch: Row) => {
          row = { id: "row-1", ...patch };
          inserts.push(patch);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, updates, inserts, getRow: () => row };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
  vi.stubEnv("UAZAPI_ADMIN_TOKEN", "admin-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provisionInstance", () => {
  it("creates a new instance and persists it when none exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { instance: { id: "inst-1" }, token: "tok-1" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { db, inserts } = makeDb(null);

    const result = await provisionInstance({
      db,
      accountId: "acc-1",
      userId: "user-1",
    });

    expect(result).toEqual({ instanceId: "inst-1", reused: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/instance/create");
    expect(init.headers.admintoken).toBe("admin-secret");
    expect(inserts[0]).toMatchObject({
      account_id: "acc-1",
      user_id: "user-1",
      instance_id: "inst-1",
      instance_token: "enc:tok-1",
    });
  });

  it("reuses the stored instance on a second call without calling the gateway", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({
      id: "row-1",
      instance_id: "inst-existing",
      instance_token: "enc:tok-existing",
    });

    const result = await provisionInstance({
      db,
      accountId: "acc-1",
      userId: "user-1",
    });

    expect(result).toEqual({ instanceId: "inst-existing", reused: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("startLogin", () => {
  function connectedDb() {
    return makeDb({
      id: "row-1",
      instance_id: "inst-1",
      instance_token: "enc:tok-1",
      webhook_secret: "enc:whsecret",
      webhook_secret_hash: createHash("sha256")
        .update("whsecret")
        .digest("hex"),
      connection_state: "disconnected",
    });
  }

  it("requests a QR code when no phone is given", async () => {
    const fetchMock = vi.fn(async (url: string, _init: RequestInit) => {
      if (String(url).endsWith("/webhook")) return jsonResponse(200, {});
      return jsonResponse(200, {
        instance: { status: "connecting", qrcode: "data:qr" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, getRow } = connectedDb();

    const result = await startLogin({
      db,
      accountId: "acc-1",
      origin: "https://app.example.com",
    });

    expect(result).toEqual({
      connectionState: "connecting",
      qrCode: "data:qr",
      pairingCode: undefined,
    });
    expect(getRow()?.connection_state).toBe("connecting");

    const connectCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/instance/connect"),
    );
    expect(JSON.parse(connectCall![1].body as string)).toEqual({});
  });

  it("requests a pairing code when a phone is given", async () => {
    const fetchMock = vi.fn(async (url: string, _init: RequestInit) => {
      if (String(url).endsWith("/webhook")) return jsonResponse(200, {});
      return jsonResponse(200, {
        instance: { status: "connecting", paircode: "1234-5678" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = connectedDb();

    const result = await startLogin({
      db,
      accountId: "acc-1",
      origin: "https://app.example.com",
      phone: "+55 11 99999-9999",
    });

    expect(result.pairingCode).toBe("1234-5678");
    const connectCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/instance/connect"),
    );
    expect(JSON.parse(connectCall![1].body as string)).toEqual({
      phone: "5511999999999",
    });
  });

  it("rejects an invalid phone before contacting the gateway", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = connectedDb();

    await expect(
      startLogin({
        db,
        accountId: "acc-1",
        origin: "https://app.example.com",
        phone: "123",
      }),
    ).rejects.toMatchObject({ code: "invalid_phone" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-provisions and retries once when the gateway rejects the stored token as invalid", async () => {
    // Simulates a dead instance_id/instance_token on record (e.g. the
    // gateway auto-deleted a never-connected instance after an hour,
    // or it was removed from the admin panel): the first
    // /instance/connect with the OLD token comes back 401, so
    // startLogin must re-provision a fresh instance and retry with the
    // NEW token rather than surfacing the error.
    let connectAttempts = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/webhook")) return jsonResponse(200, {});
      if (path.endsWith("/instance/create")) {
        return jsonResponse(200, {
          instance: { id: "inst-2" },
          token: "tok-2",
        });
      }
      if (path.endsWith("/instance/connect")) {
        connectAttempts += 1;
        if (connectAttempts === 1) {
          expect((init.headers as Record<string, string>).token).toBe("tok-1");
          return jsonResponse(401, { error: "Invalid token" });
        }
        expect((init.headers as Record<string, string>).token).toBe("tok-2");
        return jsonResponse(200, {
          instance: { status: "connecting", qrcode: "data:qr2" },
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, getRow } = connectedDb();

    const result = await startLogin({
      db,
      accountId: "acc-1",
      origin: "https://app.example.com",
    });

    expect(result).toEqual({
      connectionState: "connecting",
      qrCode: "data:qr2",
      pairingCode: undefined,
    });
    expect(connectAttempts).toBe(2);
    expect(getRow()).toMatchObject({
      instance_id: "inst-2",
      instance_token: "enc:tok-2",
      connection_state: "connecting",
    });
  });
});

describe("readInstanceStatus", () => {
  const cases: Array<[string, string | null]> = [
    ["disconnected", null],
    ["connecting", null],
    ["connected", "5511999999999"],
    ["hibernated", null],
  ];

  it.each(cases)(
    "maps gateway status %s onto stored state",
    async (status, jidUser) => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(200, {
          instance: { status },
          status: jidUser
            ? { connected: true, jid: { user: jidUser } }
            : { connected: false },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { db, getRow } = makeDb({
        id: "row-1",
        instance_id: "inst-1",
        instance_token: "enc:tok-1",
        connection_state: "connecting",
        paired_phone: null,
        paired_at: null,
      });

      const result = await readInstanceStatus(db, "acc-1");

      expect(result.connectionState).toBe(status);
      expect(getRow()?.connection_state).toBe(status);
      if (jidUser) {
        expect(result.pairedPhone).toBe(jidUser);
        expect(result.pairedAt).not.toBeNull();
      } else {
        expect(result.pairedPhone).toBeNull();
      }
    },
  );

  it("does not clear an already-paired number when the gateway omits jid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        instance: { status: "connected" },
        status: { connected: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { db, getRow } = makeDb({
      id: "row-1",
      instance_id: "inst-1",
      instance_token: "enc:tok-1",
      connection_state: "connected",
      paired_phone: "5511999999999",
      paired_at: "2026-01-01T00:00:00.000Z",
    });

    await readInstanceStatus(db, "acc-1");

    expect(getRow()?.paired_phone).toBe("5511999999999");
    expect(getRow()?.paired_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("disconnectInstance", () => {
  function pairedDb() {
    return makeDb({
      id: "row-1",
      instance_id: "inst-1",
      instance_token: "enc:tok-1",
      connection_state: "connected",
      paired_phone: "5511999999999",
      paired_at: "2026-01-01T00:00:00.000Z",
    });
  }

  it("deletes the gateway instance and clears state + instance credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { response: "Instance Deleted" }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, getRow } = pairedDb();

    const result = await disconnectInstance(db, "acc-1");
    expect(result).toEqual({ orphan: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/instance");
    expect(init.method).toBe("DELETE");
    // Authenticated with THIS account's own instance token (decrypted
    // from the loaded row) — the gateway resolves the target from the
    // token, so the delete can only ever hit this account's instance.
    expect((init.headers as Record<string, string>).token).toBe("tok-1");

    const row = getRow();
    expect(row?.connection_state).toBe("disconnected");
    expect(row?.paired_phone).toBeNull();
    expect(row?.paired_at).toBeNull();
    expect(row?.instance_id).toBeNull();
    expect(row?.instance_token).toBeNull();
  });

  it("resolves with no orphan and makes no gateway call when there is no instance to release", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb(null);

    await expect(disconnectInstance(db, "acc-1")).resolves.toEqual({
      orphan: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an orphan and still clears state + instance credentials when the gateway rejects the delete (401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid token" })),
    );
    const { db, getRow } = pairedDb();

    await expect(disconnectInstance(db, "acc-1")).resolves.toEqual({
      orphan: { instanceId: "inst-1", name: "wacrm-acc-1" },
    });

    const row = getRow();
    expect(row?.connection_state).toBe("disconnected");
    expect(row?.paired_phone).toBeNull();
    expect(row?.paired_at).toBeNull();
    expect(row?.instance_id).toBeNull();
    expect(row?.instance_token).toBeNull();
  });

  it("reports an orphan and still clears state + instance credentials when the gateway is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const { db, getRow } = pairedDb();

    await expect(disconnectInstance(db, "acc-1")).resolves.toEqual({
      orphan: { instanceId: "inst-1", name: "wacrm-acc-1" },
    });

    const row = getRow();
    expect(row?.connection_state).toBe("disconnected");
    expect(row?.instance_id).toBeNull();
    expect(row?.instance_token).toBeNull();
  });

  it("resolves with no orphan when the gateway reports the instance already gone (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: "Instância não encontrada" }),
        ),
    );
    const { db, getRow } = pairedDb();

    await expect(disconnectInstance(db, "acc-1")).resolves.toEqual({
      orphan: null,
    });

    const row = getRow();
    expect(row?.connection_state).toBe("disconnected");
    expect(row?.instance_id).toBeNull();
    expect(row?.instance_token).toBeNull();
  });

  it("leaves the account unconfigured, so the next provision creates a fresh instance", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/instance/create")) {
        return jsonResponse(200, {
          instance: { id: "inst-2" },
          token: "tok-2",
        });
      }
      return jsonResponse(200, { response: "Instance Deleted" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, getRow } = pairedDb();

    await disconnectInstance(db, "acc-1");
    expect(getRow()?.instance_id).toBeNull();
    expect(getRow()?.instance_token).toBeNull();

    const result = await provisionInstance({
      db,
      accountId: "acc-1",
      userId: "user-1",
    });

    expect(result).toEqual({ instanceId: "inst-2", reused: false });
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).endsWith("/instance/create"),
      ),
    ).toBe(true);
    expect(getRow()).toMatchObject({
      instance_id: "inst-2",
      instance_token: "enc:tok-2",
    });
  });
});

describe("ensureWebhookRegistered", () => {
  it("generates a secret, registers it, and never returns it to the caller", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const { db, getRow } = makeDb({
      id: "row-1",
      instance_id: "inst-1",
      instance_token: "enc:tok-1",
    });

    const returned = await ensureWebhookRegistered({
      db,
      accountId: "acc-1",
      origin: "https://app.example.com",
    });

    expect(returned).toBeUndefined();
    const row = getRow();
    expect(row?.webhook_secret).toMatch(/^enc:/);
    expect(row?.webhook_secret_hash).toMatch(/^[0-9a-f]{64}$/);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/webhook");
    const body = JSON.parse(init.body);
    // UAZAPI's spec documents no default for `enabled` — observed in
    // practice to leave a freshly-created webhook off, silently
    // dropping every inbound event, so this must always be explicit.
    expect(body.enabled).toBe(true);
    expect(body.events).toEqual(["messages", "messages_update", "connection"]);
    expect(body.excludeMessages).toEqual(["wasSentByApi"]);
    expect(
      body.url.startsWith("https://app.example.com/api/whatsapp/webhook/"),
    ).toBe(true);
    // Assert it never logs/returns the plaintext secret in this call's
    // return value — only the encrypted+hashed forms are asserted above.
  });

  it("does not throw when the gateway call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { error: "down" })),
    );
    const { db } = makeDb({
      id: "row-1",
      instance_id: "inst-1",
      instance_token: "enc:tok-1",
    });

    await expect(
      ensureWebhookRegistered({
        db,
        accountId: "acc-1",
        origin: "https://app.example.com",
      }),
    ).resolves.toBeUndefined();
  });
});
