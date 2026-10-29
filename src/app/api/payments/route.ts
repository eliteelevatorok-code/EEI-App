import { readPayments, readUnpaid } from "@/lib/payments";

export const runtime = "nodejs";

// Money tab (signed-in only, see proxy.ts): every payment ever logged, and the
// bills carried over unpaid from an earlier cycle.
export async function GET() {
  try {
    const [payments, unpaid] = await Promise.all([readPayments(), readUnpaid()]);
    return Response.json({ payments, unpaid: unpaid.filter((b) => !b.paidOn) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't read payments" }, { status: 502 });
  }
}
