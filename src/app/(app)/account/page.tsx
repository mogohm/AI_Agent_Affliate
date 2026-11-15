import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { PageHeading } from "@/components/page-heading";
import { ChangePasswordForm } from "@/components/account/change-password";
import { ROLE_LABELS } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "บัญชีของฉัน" };

export default async function AccountPage() {
  const s = await requirePageSession("account:self");
  return (
    <div>
      <PageHeading title="บัญชีของฉัน" description={`${s.name} · ${s.email} · ${ROLE_LABELS[s.role]}`} />
      <ChangePasswordForm />
    </div>
  );
}
