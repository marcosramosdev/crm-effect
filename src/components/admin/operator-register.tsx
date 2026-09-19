"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OperatorRow } from "@/lib/admin/operators";
import type { PlatformOperatorRole } from "@/lib/provisioning/platform-admins";

// The operator register: who can reach /admin, and at which role
// (admin-console spec.md, "The console carries the register of
// platform operators"). Manager-only — the page that renders this
// already refuses an admin-role operator via src/middleware.ts.
//
// Registering an address that already has a sign-in identity with no
// operator record (a previously removed operator) adopts it instead of
// creating a second one; the server says so via `passwordUnchanged`
// rather than this component guessing.
export function OperatorRegister({
  operators,
  currentUserId,
}: {
  operators: OperatorRow[];
  currentUserId: string | null;
}) {
  const t = useTranslations("AdminOperators");
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformOperatorRole>("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string | null } | null>(
    null,
  );
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/operators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, password }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        toast.error((json.error as string) ?? t("failed"));
        return;
      }
      const passwordUnchanged = Boolean(json.passwordUnchanged);
      setIssued({ email, password: passwordUnchanged ? null : password });
      setName("");
      setEmail("");
      setPassword("");
      setRole("admin");
      toast.success(passwordUnchanged ? t("adopted") : t("registered"));
      router.refresh();
    } catch {
      toast.error(t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setRemovingId(userId);
    try {
      const res = await fetch(`/api/admin/operators/${userId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        toast.error((json.error as string) ?? t("failed"));
        return;
      }
      setConfirmingId(null);
      toast.success(t("removed"));
      router.refresh();
    } catch {
      toast.error(t("networkError"));
    } finally {
      setRemovingId(null);
    }
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
    <div className="flex flex-col gap-6">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">{t("registerTitle")}</CardTitle>
          <CardDescription>{t("registerDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={register} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-foreground">{t("nameLabel")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">{t("emailLabel")}</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-foreground">{t("roleLabel")}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={role === "admin" ? "default" : "outline"}
                    onClick={() => setRole("admin")}
                    className="flex-1"
                  >
                    {t("roleAdmin")}
                  </Button>
                  <Button
                    type="button"
                    variant={role === "manager" ? "default" : "outline"}
                    onClick={() => setRole("manager")}
                    className="flex-1"
                  >
                    {t("roleManager")}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">{t("passwordLabel")}</Label>
                <Input
                  type="text"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                />
                <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
              </div>
            </div>
            <Button
              type="submit"
              disabled={busy || !name.trim() || !email.trim()}
              className="self-start"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : t("submit")}
            </Button>
          </form>

          {issued && (
            <div className="border-border bg-muted mt-4 space-y-2 rounded-md border px-3 py-3">
              <p className="text-foreground text-sm">
                {issued.password
                  ? t("issuedFor", { email: issued.email })
                  : t("adoptedFor", { email: issued.email })}
              </p>
              {issued.password && (
                <div className="flex items-center gap-2">
                  <span className="text-foreground flex-1 font-mono text-xs break-all">
                    {issued.password}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copy(issued.password!)}
                  >
                    <Copy className="size-4" />
                    {t("copy")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {operators.map((op) => {
            const isSelf = op.userId !== null && op.userId === currentUserId;
            const canRemove = !op.seeded && !isSelf && op.userId !== null;
            const key = op.userId ?? op.email;

            return (
              <div
                key={key}
                className="border-border flex flex-col gap-2 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-medium">
                      {op.fullName ?? op.email}
                    </span>
                    <Badge variant={op.role === "manager" ? "default" : "secondary"}>
                      {op.role === "manager" ? t("roleManager") : t("roleAdmin")}
                    </Badge>
                    {op.seeded && <Badge variant="outline">{t("seededBadge")}</Badge>}
                  </div>
                  <p className="text-muted-foreground text-xs">{op.email}</p>
                  <p className="text-muted-foreground text-xs">
                    {op.seeded
                      ? t("seededHint")
                      : t("registeredBy", {
                          name: op.createdByName ?? t("unknownRegistrar"),
                          date: op.createdAt ? new Date(op.createdAt).toLocaleString() : "",
                        })}
                  </p>
                </div>

                {canRemove &&
                  (confirmingId === op.userId ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-destructive text-xs">{t("confirmRemove")}</span>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={removingId === op.userId}
                        onClick={() => remove(op.userId!)}
                      >
                        {removingId === op.userId ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          t("confirmRemoveButton")
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmingId(null)}
                      >
                        {t("cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingId(op.userId)}
                    >
                      <Trash2 className="size-4" />
                      {t("remove")}
                    </Button>
                  ))}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
