import { route } from "@/lib/api";
import { systemStatus } from "@/lib/admin/system";

export const GET = route({ permission: "settings:read" }, async () => systemStatus());
