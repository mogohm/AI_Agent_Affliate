import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { PageHeading } from "@/components/page-heading";
import { UsersSettings } from "@/components/settings/users-settings";

export const metadata: Metadata = { title: "ผู้ใช้งาน" };

export default async function UsersPage() {
  await requirePageSession("users:manage");
  return (
    <div>
      <PageHeading title="ผู้ใช้งาน" description="สร้างผู้ใช้ใหม่ กำหนดบทบาท เปิด/ปิดการใช้งาน และรีเซ็ตรหัสผ่าน" />
      <UsersSettings />
    </div>
  );
}
