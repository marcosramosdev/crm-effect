import { ProvisioningForm } from "@/components/admin/provisioning-form";

// The /admin guard already ran in middleware.ts (PLATFORM_ADMINS) —
// this page assumes it only ever renders for a listed operator.
export default function AdminPage() {
  return (
    <div className="bg-background flex min-h-screen justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <ProvisioningForm />
      </div>
    </div>
  );
}
