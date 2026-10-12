import { randomBytes } from "node:crypto";
import { QB_SCOPE, connectKeys, endpoints } from "@/lib/quickbooks";

export const runtime = "nodejs";

// Settings → QuickBooks → Connect. Sends Robert to Intuit's own sign-in page to
// let the app bill through his real QuickBooks company; Intuit then returns him to
// /api/quickbooks/callback. Behind the app login. Needs his production keys in the
// Config tab first (qbClientId / qbClientSecret).
// ?company=test connects the TEST company instead (development keys) — for
// testing connect / disconnect / reconnect without touching the real books.
// The random `state` (also kept in a short-lived cookie, with which company)
// makes sure the answer that comes back is the one we asked for.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const test = url.searchParams.get("company") === "test";
  const { clientId } = await connectKeys(test);
  if (!clientId) return Response.redirect(`${url.origin}/?tab=settings&qb=nokeys`, 302);
  const state = randomBytes(16).toString("hex");
  const go = new URL((await endpoints(!test)).authorize);
  go.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: QB_SCOPE,
    redirect_uri: `${url.origin}/api/quickbooks/callback`,
    state,
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: go.toString(),
      "Set-Cookie": `eei_qbstate=${test ? "test" : "real"}.${state}; Path=/api/quickbooks; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
