import { finishConnect } from "@/lib/quickbooks";

export const runtime = "nodejs";

// Intuit sends Robert back here after he signs in (see ../connect). Swap the
// one-time code for the long-lived sign-in and keep it, with the company id, in
// the private Config tab — it never appears on screen or in any address. Then
// back to Settings.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (result: string) => Response.redirect(`${url.origin}/?tab=settings&qb=${result}`, 302);
  const cookie = req.headers.get("cookie") ?? "";
  const expected = cookie.match(/(?:^|;\s*)eei_qbstate=([0-9a-f]+)/)?.[1];
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId") ?? "";
  if (!code || !/^\d+$/.test(realmId) || !expected || url.searchParams.get("state") !== expected) return back("failed");
  try {
    await finishConnect(code, realmId, `${url.origin}/api/quickbooks/callback`);
    return back("connected");
  } catch (e) {
    console.error("[quickbooks] connect failed:", e instanceof Error ? e.message : e);
    return back("failed");
  }
}
