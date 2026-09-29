import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppBoot } from "@/components/AppBoot";
import "./globals.css";

// The app's typeface (served with the app, no outside request). The style guide
// in globals.css uses it through --font-sans.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "EEI Field Reports",
  description: "Elite Elevator Inspections — field report and dashboard control.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon-32.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F3F7F4", // matches --color-page, so the phone's status bar blends in
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en" className={inter.variable}>
        <body className="min-h-dvh">
          <AppBoot />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
