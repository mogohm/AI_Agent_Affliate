/** Role-based access control. Shared by server (enforcement) and client (hiding controls). */
export const ROLES = ["admin", "editor", "approver", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor",
  approver: "Approver",
  viewer: "Viewer",
};

const P = {
  "products:read": ["admin", "editor", "approver", "viewer"],
  "products:write": ["admin", "editor"],
  "video:read": ["admin", "editor", "approver", "viewer"],
  "video:create": ["admin", "editor"],
  "video:approve": ["admin", "approver"],
  "video:publish": ["admin", "approver"],
  "video:export": ["admin", "editor", "approver"],
  "jobs:manage": ["admin", "editor"],
  "automation:read": ["admin", "editor", "approver", "viewer"],
  "automation:manage": ["admin", "editor"],
  "analytics:read": ["admin", "editor", "approver", "viewer"],
  "analytics:import": ["admin", "editor"],
  "settings:read": ["admin", "editor", "approver", "viewer"],
  "settings:manage": ["admin"],
  "credentials:manage": ["admin"],
  "users:manage": ["admin"],
  "audit:read": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof P;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (P[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(P) as Permission[]).filter((p) => can(role, p));
}
