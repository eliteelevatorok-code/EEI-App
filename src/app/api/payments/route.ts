import { readPayments } from "@/lib/payments";

export const runtime = "nodejs";

// Money tab (signed-in only, see proxy.ts): every payment ever logged.
export async function GET() {
  try {
    return Response.json({ payments: await readPayments() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't read payments" }, { status: 502 });
  }
}
