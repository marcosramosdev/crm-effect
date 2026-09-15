"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { WhatsAppConnectionProvider } from "@/hooks/use-whatsapp-connection";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    // Shared WhatsApp connection status for the sidebar logo, the mobile
    // header dot, and the /connection page. Mounted here (after the auth
    // guard) so it only polls for a signed-in user.
    <WhatsAppConnectionProvider>
      <div className="bg-background flex h-screen overflow-hidden">
        {/* Reports this tab's online/away presence once we know a user is
            signed in. Headless — renders nothing. */}
        <PresenceHeartbeat />
        <Sidebar open={sidebarOpen} onClose={closeSidebar} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header onOpenSidebar={() => setSidebarOpen(true)} />
          {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            {/* Above every page: writes are being rejected and here's why.
                Renders nothing unless the account/role failed to resolve. */}
            <AccountAccessAlert />
            {children}
          </main>
        </div>
      </div>
    </WhatsAppConnectionProvider>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
