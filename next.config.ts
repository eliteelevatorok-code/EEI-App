import type { NextConfig } from "next";

// Stamp the build so the app can show which version it's running. On Vercel,
// VERCEL_GIT_COMMIT_SHA is set automatically for each deploy.
const sha = process.env.VERCEL_GIT_COMMIT_SHA || "local";
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: sha.slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
