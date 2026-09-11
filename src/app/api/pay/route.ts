import { findForPay, markPaid } from "@/lib/pay";

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
export async function POST(req: Request) {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return Response.json({ error: message }, { status: 502 });
  }
  return Response.json({ ok: true });
}
