import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PrefsProvider } from "@/lib/theme";
import Header from "@/components/Header";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "MONUMENTAL — guess the height",
  description: "Real-time multiplayer game: drag a monument to its true height relative to another. Pyramids vs skyscrapers, Moai vs Burj Khalifa.",
  applicationName: "MONUMENTAL",
};
export const viewport: Viewport = { themeColor: "#f97316", width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('monumental:theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body className="min-h-dvh">
        <PrefsProvider>
          <Header user={user} />
          <main className="pb-10">{children}</main>
        </PrefsProvider>
      </body>
    </html>
  );
}
