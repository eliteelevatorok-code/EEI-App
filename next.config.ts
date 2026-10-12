import type { NextConfig } from "next";

// Stamp the build so the app can show which version it's running. On Vercel,
// VERCEL_GIT_COMMIT_SHA is set automatically for each deploy.
const sha = process.env.VERCEL_GIT_COMMIT_SHA || "local";
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: sha.slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  // Security headers Intuit's rules ask for (QuickBooks production review):
  //  - Referrer-Policy: the private links in emails (/po, /maint, /pay?t=…) carry
  //    a token in the address; never pass that address on to another site.
  //  - API answers hold business data: never stored by a browser or proxy.
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, no-cache, max-age=0, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
