import { randomBytes } from "node:crypto";
import { DRIVE_SCOPE, googleSignIn } from "@/lib/google";

export const runtime = "nodejs";

// Settings → Google Drive → Connect. Sends Robert to Google's own sign-in page
// to let the app save report PDFs in his Drive; Google then returns him to
// /api/google/callback. Behind the app login. The random `state` (also kept in a
// short-lived cookie) makes sure the answer that comes back is the one we asked for.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const state = randomBytes(16).toString("hex");
  const url = googleSignIn(`${origin}/api/google/callback`).generateAuthUrl({
    access_type: "offline", // a long-lived sign-in, not a one-hour one
    prompt: "consent", // always hand back that long-lived token
    scope: [DRIVE_SCOPE], // only files this app creates — not the rest of his Drive
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Set-Cookie": `eei_gstate=${state}; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
