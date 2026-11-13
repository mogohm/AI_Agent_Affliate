"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormRow, Input } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { api } from "@/lib/client/api";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      router.replace(dest);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FormRow label="อีเมล" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </FormRow>
      <FormRow label="รหัสผ่าน" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </FormRow>
      {error && <ErrorState error={error} className="mb-4" />}
      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        เข้าสู่ระบบ
      </Button>
    </form>
  );
}
