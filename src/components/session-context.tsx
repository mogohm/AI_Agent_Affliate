"use client";
import * as React from "react";
import { can as canRole, type Permission, type Role } from "@/lib/auth/permissions";

export type ClientSession = {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspaceName: string;
  aiMode: "demo" | "live";
};

const Ctx = React.createContext<ClientSession | null>(null);

export function SessionProvider({ value, children }: { value: ClientSession; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): ClientSession {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}

/** UI-only permission check (the server always enforces RBAC independently). */
export function useCan(permission: Permission): boolean {
  return canRole(useSession().role, permission);
}
