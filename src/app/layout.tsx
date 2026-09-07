import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { AppBoot } from "@/components/AppBoot";
import "./globals.css";

export const metadata: Metadata = {
  title: "EEI Field Reports",
  description: "Elite Elevator Inspections — field report and dashboard control.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon-32.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "EEI Field", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1F4B45",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-dvh bg-stone-100 text-stone-900 antialiased">
          <AppBoot />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
