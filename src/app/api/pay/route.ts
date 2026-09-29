import { findForPay, markPaid } from "@/lib/pay";
import { IS_SANDBOX } from "@/lib/quickbooks";

export const runtime = "nodejs";

// GET /api/pay?t=<token> → { building, price, alreadyPaid } so the page can show
// which building and amount. Reveals nothing without a valid token.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const el = await findForPay(token);
  if (!el) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ building: el.building, price: el.price, alreadyPaid: el.alreadyPaid });
}

// POST { token } → flips the row's Paid box to "Paid". A deliberate button press,
// not a link the email client can trigger by prefetching.
// TEST ONLY: once QuickBooks is on the real company, payment is detected from the
// QuickBooks balance, so this button is refused — otherwise anyone holding the
// link could mark a bill paid without paying.
export async function POST(req: Request) {
  if (!IS_SANDBOX) {
    return Response.json({ error: "Please pay using the link in your QuickBooks invoice." }, { status: 403 });
  }
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const el = await findForPay(String(body.token ?? ""));
  if (!el) return Response.json({ error: "This link isn't recognized." }, { status: 404 });
  try {
    await markPaid(el.row);
  } catch {
    return Response.json({ error: "Couldn't save just now — please try again in a minute." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
