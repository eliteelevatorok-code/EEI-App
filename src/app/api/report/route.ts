import { sendProblemAlert } from "@/lib/push";
import { finishedReport } from "@/lib/report";
import { cell, findByToken } from "@/lib/sheet";

export const runtime = "nodejs";

// Public, token-keyed: /api/report?t=<token> returns the elevator's FINISHED
// inspection report (the filled PDF saved to Drive when the report was finished
// in the app) so the Make automation can attach it to the customer and ODOL
// "report filed" emails (route 6).
// No finished report for this visit → 404, and Make holds the email (it only
// sends on a 200) until the report is finished; the phone gets an alert meanwhile.
export async function GET(req: Request) {
  const hit = await findByToken(new URL(req.url).searchParams.get("t") ?? "");
  if (!hit) return new Response("not found", { status: 404 });
  let report: Awaited<ReturnType<typeof finishedReport>>;
  try {
    report = await finishedReport(hit.cells, true);
  } catch (err) {
    // Drive couldn't be read. Make holds the email (it only sends on a 200) and
    // tries again next hour — tell Robert's phone so it isn't a silent hold.
    const message = err instanceof Error ? err.message : "Drive couldn't be read";
    await sendProblemAlert(cell(hit.cells, "okla"), cell(hit.cells, "building"), "report email", message).catch(() => {});
    return new Response("couldn't read the report right now", { status: 503 });
  }
  if (!report?.bytes) return new Response("no finished report for this visit yet", { status: 404 });
  const okla = cell(hit.cells, "okla") || "elevator";
  return new Response(Buffer.from(report.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="inspection-report-${okla}.pdf"`,
    },
  });
}
