import { logPayment } from "@/lib/payments";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";
import { sendProblemAlert } from "@/lib/push";
import { FIRST_ROW, cell, readRow } from "@/lib/sheet";

export const runtime = "nodejs";

// Called by the Make "daily lifecycle" scenario right before the yearly reset
// (route "New timer set"): /api/payments/log?row=N saves row N's payment to the
// Payments tab (see src/lib/payments.ts). Scheduler key required (public route).
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;
  const n = Number(new URL(req.url).searchParams.get("row") ?? "");
  if (!Number.isInteger(n) || n < FIRST_ROW) return Response.json({ error: "bad row" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await logPayment(n)) });
  } catch (err) {
    // The reset still goes ahead (Make moves on), so say so on Robert's phone.
    const message = err instanceof Error ? err.message : "failed";
    const r = await readRow(n).catch(() => [] as string[]);
    await sendProblemAlert(cell(r, "okla"), cell(r, "building"), "payment log", message).catch(() => {});
    return Response.json({ error: message }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
