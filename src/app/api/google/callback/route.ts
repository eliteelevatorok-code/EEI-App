import { writeConfig } from "@/lib/config";
import { DRIVE_TOKEN, googleSignIn } from "@/lib/google";

export const runtime = "nodejs";

// Google sends Robert back here after he signs in (see ../connect). Swap the
// one-time code for the long-lived sign-in token and keep it in the private
// Config tab — it never appears on screen or in any address. Then back to Settings.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (result: string) => Response.redirect(`${url.origin}/?tab=settings&drive=${result}`, 302);
  const cookie = req.headers.get("cookie") ?? "";
  const expected = cookie.match(/(?:^|;\s*)eei_gstate=([0-9a-f]+)/)?.[1];
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("failed");
  try {
    const { tokens } = await googleSignIn(`${url.origin}/api/google/callback`).getToken(code);
    if (!tokens.refresh_token) return back("failed");
    await writeConfig(DRIVE_TOKEN, tokens.refresh_token);
    return back("connected");
  } catch {
    return back("failed");
  }
}
