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
  const report = await finishedReport(hit.cells, true);
  if (!report?.bytes) return new Response("no finished report for this visit yet", { status: 404 });
  const okla = cell(hit.cells, "okla") || "elevator";
  return new Response(Buffer.from(report.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="inspection-report-${okla}.pdf"`,
    },
  });
}
