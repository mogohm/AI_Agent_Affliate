export const THEME_COOKIE = "aas_theme";
export type ThemeKey = "A" | "B" | "C";
export const THEMES: { key: ThemeKey; name: string; description: string }[] = [
  { key: "A", name: "Command Center", description: "Dashboard & Product Management (dark)" },
  { key: "B", name: "Creative Studio", description: "AI Video Studio (light)" },
  { key: "C", name: "Automation Factory", description: "Automation & Operations (green)" },
];
