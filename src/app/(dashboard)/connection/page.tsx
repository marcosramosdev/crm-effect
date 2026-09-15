"use client";

import { ConnectionManager } from "@/components/connection/connection-manager";

// The WhatsApp connection is the app's primary function, so it gets its
// own top-level page instead of a settings tab. Persisted status is
// always visible in the app chrome (sidebar logo / mobile header dot);
// this page is where you connect and disconnect.
export default function ConnectionPage() {
  return <ConnectionManager />;
}
