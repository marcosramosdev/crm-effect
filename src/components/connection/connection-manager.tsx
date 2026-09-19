"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  QrCode,
  KeyRound,
  Unplug,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { useWhatsAppConnection } from "@/hooks/use-whatsapp-connection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import { formatDateTime } from "@/lib/format";
import type { WhatsAppConnectionState } from "@/types";

/** How often we poll `action=status` while a login attempt is in flight. */
const STATUS_POLL_MS = 3000;
/** The gateway's QR expiry is ~2 minutes; refresh a little before that. */
const QR_REFRESH_MS = 100_000;
/** Give up refreshing (QR) or waiting (pairing code) after this many misses. */
const MAX_REFRESH_CYCLES = 5;

type LoginMode = "idle" | "qr" | "pairing" | "timed_out";

async function callConfigAction<T>(
  action: string,
  extra?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/whatsapp/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

/**
 * The dedicated WhatsApp connection surface: persisted status plus —
 * for an owner or admin — Connect (QR or pairing code) and Disconnect,
 * and nothing else. Does not disclose that an unofficial gateway is
 * used (whatsapp-connection spec, "Operator-facing connection UI does
 * not disclose the gateway").
 */
export function ConnectionManager() {
  const t = useTranslations("Connection");
  const { canEditSettings } = useAuth();
  const { state, pairedPhone, pairedAt, loaded, refetch } =
    useWhatsAppConnection();

  const [busy, setBusy] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>("idle");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [usePairingCode, setUsePairingCode] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshCyclesRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (refreshRef.current) clearInterval(refreshRef.current);
    pollRef.current = null;
    refreshRef.current = null;
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const beginPolling = useCallback(() => {
    clearTimers();
    pollRef.current = setInterval(async () => {
      try {
        const status = await callConfigAction<{
          connectionState: WhatsAppConnectionState;
          pairedPhone: string | null;
        }>("status");
        if (status.connectionState === "connected") {
          clearTimers();
          setLoginMode("idle");
          setQrCode(null);
          setPairingCode(null);
          toast.success(
            t("connectedToast", { phone: status.pairedPhone ?? "" }),
          );
          await refetch();
        }
      } catch (err) {
        console.error("Status poll failed:", err);
      }
    }, STATUS_POLL_MS);
  }, [clearTimers, refetch, t]);

  const startLogin = useCallback(
    async (phone?: string) => {
      setBusy(true);
      try {
        const result = await callConfigAction<{
          connectionState: WhatsAppConnectionState;
          qrCode?: string;
          pairingCode?: string;
        }>("start_login", phone ? { phone } : {});

        if (result.pairingCode) {
          setLoginMode("pairing");
          setPairingCode(result.pairingCode);
          setQrCode(null);
        } else {
          setLoginMode("qr");
          setQrCode(result.qrCode ?? null);
          setPairingCode(null);
        }
        refreshCyclesRef.current = 0;
        beginPolling();

        if (!phone) {
          // QR codes expire after ~2 minutes; silently fetch a fresh
          // one a little before that, for a bounded number of cycles.
          refreshRef.current = setInterval(async () => {
            refreshCyclesRef.current += 1;
            if (refreshCyclesRef.current > MAX_REFRESH_CYCLES) {
              clearTimers();
              setLoginMode("timed_out");
              return;
            }
            try {
              const refreshed = await callConfigAction<{ qrCode?: string }>(
                "start_login",
              );
              if (refreshed.qrCode) setQrCode(refreshed.qrCode);
            } catch (err) {
              console.error("QR refresh failed:", err);
            }
          }, QR_REFRESH_MS);
        } else {
          // Pairing codes are valid for 5 minutes with no refresh path.
          refreshRef.current = setInterval(() => {
            clearTimers();
            setLoginMode("timed_out");
          }, 5 * 60_000);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t("connectFailed");
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [beginPolling, clearTimers, t],
  );

  async function handleStartQrLogin() {
    await startLogin();
  }

  async function handleStartPairingLogin() {
    if (!phoneInput.trim()) {
      toast.error(t("phoneRequired"));
      return;
    }
    await startLogin(phoneInput.trim());
  }

  function handleCancelLogin() {
    clearTimers();
    setLoginMode("idle");
    setQrCode(null);
    setPairingCode(null);
  }

  async function handleDisconnect() {
    if (!confirm(t("disconnectConfirm"))) return;
    setBusy(true);
    try {
      await callConfigAction("disconnect");
      toast.success(t("disconnectedToast"));
      clearTimers();
      setLoginMode("idle");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("disconnectFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t("title")} description={t("description")} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      </section>
    );
  }

  const isConnected = state === "connected";
  const isConnecting =
    state === "connecting" || loginMode === "qr" || loginMode === "pairing";

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <div className="max-w-2xl space-y-6">
        {/* Persisted connection status */}
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <CheckCircle2 className="text-primary size-4" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {isConnected
                ? t("statusConnected")
                : state === "hibernated"
                  ? t("statusHibernated")
                  : isConnecting
                    ? t("statusConnecting")
                    : t("statusDisconnected")}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {isConnected && pairedPhone
              ? t("connectedDesc", {
                  phone: pairedPhone,
                  date: pairedAt
                    ? formatDateTime(pairedAt)
                    : t("unknownDate"),
                })
              : t("notConnectedDesc")}
          </AlertDescription>
        </Alert>

        {!canEditSettings && (
          <Alert className="bg-card border-border">
            <AlertDescription className="text-muted-foreground text-sm">
              {t("insufficientRole")}
            </AlertDescription>
          </Alert>
        )}

        {/* Connect wizard — admin only, and only when not connected. */}
        {canEditSettings && !isConnected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">
                {t("connectTitle")}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t("connectDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loginMode === "idle" && (
                <div className="flex flex-wrap gap-3">
                  <Button onClick={handleStartQrLogin} disabled={busy}>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <QrCode className="size-4" />
                    )}
                    {t("connectWithQr")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setUsePairingCode((v) => !v)}
                    className="border-border text-muted-foreground"
                  >
                    <KeyRound className="size-4" />
                    {t("connectWithPairingCode")}
                  </Button>
                </div>
              )}

              {loginMode === "idle" && usePairingCode && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground">
                      {t("phoneLabel")}
                    </Label>
                    <Input
                      placeholder="5511999999999"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <Button onClick={handleStartPairingLogin} disabled={busy}>
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    {t("getPairingCode")}
                  </Button>
                </div>
              )}

              {loginMode === "qr" && (
                <div className="border-border flex flex-col items-center gap-3 rounded-md border p-4">
                  {qrCode ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrCode}
                      alt={t("qrAlt")}
                      className="size-56 rounded bg-white p-2"
                    />
                  ) : (
                    <Loader2 className="text-primary size-6 animate-spin" />
                  )}
                  <p className="text-muted-foreground text-center text-sm">
                    {t("qrInstructions")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelLogin}
                  >
                    {t("cancel")}
                  </Button>
                </div>
              )}

              {loginMode === "pairing" && (
                <div className="border-border flex flex-col items-center gap-3 rounded-md border p-4">
                  <p className="text-foreground font-mono text-2xl tracking-widest">
                    {pairingCode}
                  </p>
                  <p className="text-muted-foreground text-center text-sm">
                    {t("pairingInstructions")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelLogin}
                  >
                    {t("cancel")}
                  </Button>
                </div>
              )}

              {loginMode === "timed_out" && (
                <div className="border-border flex flex-col items-center gap-3 rounded-md border p-4">
                  <AlertTriangle className="size-5 text-amber-400" />
                  <p className="text-muted-foreground text-sm">
                    {t("loginTimedOut")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelLogin}
                  >
                    <RefreshCw className="size-3.5" />
                    {t("restartLogin")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Connected — pairing summary + disconnect */}
        {canEditSettings && isConnected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">
                {t("connectedTitle")}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {pairedPhone ?? ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={busy}
                className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Unplug className="size-4" />
                {t("disconnect")}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
