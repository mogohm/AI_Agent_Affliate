"use client";
import * as React from "react";
import { UserPlus, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormRow, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ErrorState, LoadingRows, Note } from "@/components/ui/states";
import { Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { useSession } from "@/components/session-context";
import { api, useApi } from "@/lib/client/api";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { dateTime } from "@/lib/format";

type Member = { id: string; email: string; name: string; isActive: boolean; lastLoginAt: string | null; createdAt: string; role: Role };

const ROLE_DESC: Record<Role, string> = {
  admin: "ทุกสิทธิ์ รวม Credentials, ผู้ใช้, Audit",
  editor: "จัดการสินค้า สร้างวิดีโอ กฎอัตโนมัติ",
  approver: "ตรวจ อนุมัติ และเผยแพร่คอนเทนต์",
  viewer: "ดูข้อมูลอย่างเดียว",
};

export function UsersSettings() {
  const me = useSession();
  const r = useApi<{ items: Member[] }>("/api/users");
  const [creating, setCreating] = React.useState(false);
  const [tempPw, setTempPw] = React.useState<{ email: string; password: string } | null>(null);

  const patch = async (m: Member, body: Record<string, unknown>, msg: string) => {
    try {
      const res = await api<{ temporaryPassword: string | null }>(`/api/users/${m.id}`, { method: "PATCH", body });
      if (res.temporaryPassword) setTempPw({ email: m.email, password: res.temporaryPassword });
      toast.success(msg);
      await r.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows rows={4} />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-[11px] text-muted">
          {ROLES.map((x) => (
            <span key={x}>
              <b className="text-fg">{ROLE_LABELS[x]}</b>: {ROLE_DESC[x]}
            </span>
          ))}
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <UserPlus /> เพิ่มผู้ใช้
        </Button>
      </div>
      <TableWrap>
        <Table className="min-w-[700px]">
          <THead>
            <tr>
              <Th>ผู้ใช้</Th>
              <Th>บทบาท</Th>
              <Th>ใช้งาน</Th>
              <Th>เข้าสู่ระบบล่าสุด</Th>
              <Th className="text-right">จัดการ</Th>
            </tr>
          </THead>
          <tbody>
            {r.data.items.map((m) => (
              <Tr key={m.id} data-testid="user-row">
                <Td>
                  <div className="font-bold">
                    {m.name} {m.id === me.id && <Badge tone="muted">คุณ</Badge>}
                  </div>
                  <div className="text-[11px] text-muted">{m.email}</div>
                </Td>
                <Td>
                  <Select aria-label={`บทบาทของ ${m.email}`} className="w-36 py-1.5 text-xs" value={m.role} onChange={(e) => patch(m, { role: e.target.value }, "เปลี่ยนบทบาทแล้ว")}>
                    {ROLES.map((x) => (
                      <option key={x} value={x}>
                        {ROLE_LABELS[x]}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Switch checked={m.isActive} disabled={m.id === me.id} onCheckedChange={(v) => patch(m, { isActive: v }, v ? "เปิดใช้งานผู้ใช้" : "ปิดการใช้งานผู้ใช้")} aria-label={`เปิด/ปิด ${m.email}`} />
                </Td>
                <Td className="text-muted">{m.lastLoginAt ? dateTime(m.lastLoginAt) : "ยังไม่เคย"}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => patch(m, { resetPassword: true }, "สร้างรหัสผ่านชั่วคราวแล้ว")}>
                    <KeyRound /> รีเซ็ตรหัสผ่าน
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <DialogContent title="เพิ่มผู้ใช้" description="ระบบจะสร้างรหัสผ่านชั่วคราวหากไม่ได้กำหนด">
            <CreateUser
              onCreated={async (email, pw) => {
                setCreating(false);
                if (pw) setTempPw({ email, password: pw });
                await r.reload();
              }}
            />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!tempPw} onOpenChange={(o) => !o && setTempPw(null)}>
        {tempPw && (
          <DialogContent title="รหัสผ่านชั่วคราว" description={tempPw.email}>
            <Note tone="warn" className="mb-3">
              แสดงครั้งเดียวเท่านั้น — ส่งให้ผู้ใช้ผ่านช่องทางที่ปลอดภัยและให้เปลี่ยนหลังเข้าสู่ระบบ
            </Note>
            <code className="block rounded-lg bg-surface-2 p-3 text-center font-mono text-base select-all">{tempPw.password}</code>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function CreateUser({ onCreated }: { onCreated: (email: string, password: string | null) => void }) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("editor");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ temporaryPassword: string | null; user: { email: string } }>("/api/users", { method: "POST", body: { email, name, role } });
      toast.success("เพิ่มผู้ใช้แล้ว");
      onCreated(r.user.email, r.temporaryPassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <FormRow label="อีเมล" htmlFor="u-email">
        <Input id="u-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </FormRow>
      <FormRow label="ชื่อ" htmlFor="u-name">
        <Input id="u-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </FormRow>
      <FormRow label="บทบาท" htmlFor="u-role" hint={ROLE_DESC[role]}>
        <Select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((x) => (
            <option key={x} value={x}>
              {ROLE_LABELS[x]}
            </option>
          ))}
        </Select>
      </FormRow>
      {error && <ErrorState error={error} className="mb-3" />}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          เพิ่มผู้ใช้
        </Button>
      </div>
    </form>
  );
}
