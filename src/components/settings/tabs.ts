export const SETTINGS_TABS = ["connections", "ai", "video", "templates", "budget", "scoring", "users", "audit", "system"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
