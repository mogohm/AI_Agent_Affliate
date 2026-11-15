"use client";
import * as React from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormRow, Input } from "@/components/ui/form";
import { api } from "@/lib/client/api";

export function ChangePasswordForm() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError("รหัสผ่านใหม่อย่างน้อย 10 ตัวอักษร");
    if (next !== confirm) return setError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
    setBusy(true);
    try {
      await api("/api/account/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      toast.success("เปลี่ยนรหัสผ่านแล้ว");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader title="เปลี่ยนรหัสผ่าน" description="ใช้อย่างน้อย 10 ตัวอักษร ผสมตัวอักษร ตัวเลข และสัญลักษณ์" />
      <form onSubmit={submit} data-testid="change-password-form">
        <FormRow label="รหัสผ่านปัจจุบัน" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </FormRow>
        <FormRow label="รหัสผ่านใหม่" htmlFor="pw-new">
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </FormRow>
        <FormRow label="ยืนยันรหัสผ่านใหม่" htmlFor="pw-confirm">
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </FormRow>
        {error && (
          <p role="alert" className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          <KeyRound /> {busy ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}
        </Button>
      </form>
    </Card>
  );
}
