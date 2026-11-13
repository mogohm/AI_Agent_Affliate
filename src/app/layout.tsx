import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import "./globals.css";
import { THEME_COOKIE } from "@/lib/theme";

const thai = localFont({
  src: [
    { path: "../../assets/fonts/IBMPlexSansThai-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../assets/fonts/IBMPlexSansThai-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../assets/fonts/IBMPlexSansThai-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "AI Affiliate Studio", template: "%s · AI Affiliate Studio" },
  description: "Affiliate product intelligence & AI video studio for Shopee and Lazada",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };



export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const t = store.get(THEME_COOKIE)?.value;
  const theme = t === "B" || t === "C" ? t : "A";
  return (
    <html lang="th" data-theme={theme} className={thai.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--accent)", fontFamily: "var(--font-thai)" },
          }}
        />
      </body>
    </html>
  );
}
