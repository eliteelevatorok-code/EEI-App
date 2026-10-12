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
  const saved = cookie.match(/(?:^|;\s*)eei_qbstate=(real|test)\.([0-9a-f]+)/);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId") ?? "";
  if (!code || !/^\d+$/.test(realmId) || !saved || url.searchParams.get("state") !== saved[2]) return back("failed");
  const test = saved[1] === "test";
  try {
    await finishConnect(code, realmId, `${url.origin}/api/quickbooks/callback`, test);
    return back(test ? "testconnected" : "connected");
  } catch (e) {
    console.error("[quickbooks] connect failed:", e instanceof Error ? e.message : e);
    return back("failed");
  }
}
