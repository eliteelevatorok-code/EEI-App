import { randomBytes } from "node:crypto";
import { AUTHORIZE_URL, QB_SCOPE, realKeys } from "@/lib/quickbooks";

export const runtime = "nodejs";

// Settings → QuickBooks → Connect. Sends Robert to Intuit's own sign-in page to
// let the app bill through his real QuickBooks company; Intuit then returns him to
// /api/quickbooks/callback. Behind the app login. Needs his production keys in the
// Config tab first (qbClientId / qbClientSecret). The random `state` (also kept in
// a short-lived cookie) makes sure the answer that comes back is the one we asked for.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const { clientId } = await realKeys();
  if (!clientId) return Response.redirect(`${origin}/?tab=settings&qb=nokeys`, 302);
  const state = randomBytes(16).toString("hex");
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: QB_SCOPE,
    redirect_uri: `${origin}/api/quickbooks/callback`,
    state,
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": `eei_qbstate=${state}; Path=/api/quickbooks; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}
