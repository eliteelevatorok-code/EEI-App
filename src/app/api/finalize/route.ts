import { readFile } from "node:fs/promises";
import path from "node:path";
import { fillReport, type FinalizePayload } from "@/lib/fillForm";
import { uploadFile } from "@/lib/google";
import { findRowByOkla, markInspected, setReportFile } from "@/lib/roster";
import { NoSuchRow, cell, readRow, requireElevatorRow } from "@/lib/sheet";
import { inspectionBlocked } from "@/lib/inOrder";
import { dispositionFor, reportFileName } from "@/lib/reportName";

export const runtime = "nodejs";

// Turn "2026-09-07" (or already m/d/yyyy) into m/d/yyyy for the Trip day cell.
function displayDate(s: string): string {
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${+iso[2]}/${+iso[3]}/${iso[1]}`;
  return s;
}

// POST a { elevator, report } payload. Builds the filled PDF, saves it to the
// Drive Reports folder, flips the dashboard's lifecycle cells, and returns the
// PDF (with the Drive link in a header) so the phone can open it.
export async function POST(req: Request) {
  let payload: FinalizePayload;
  try {
    payload = (await req.json()) as FinalizePayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload?.elevator || !payload?.report) {
    return Response.json({ error: "Missing elevator or report" }, { status: 400 });
  }
  // A clear message instead of a crash when something's missing (e.g. an old draft).
  const e = payload.elevator, r = payload.report;
  if (!String(e.okla ?? "").trim()) return Response.json({ error: "This report isn't tied to an elevator." }, { status: 400 });
  if (!String(r.date ?? "").trim()) return Response.json({ error: "Add the inspection date before finishing." }, { status: 400 });
  e.carried = Array.isArray(e.carried) ? e.carried : [];
  r.added = Array.isArray(r.added) ? r.added : [];
  for (const k of ["inspType", "cycle", "test1", "test5", "certIssue", "condition", "notes"] as const) r[k] = String(r[k] ?? "");

  // Find the elevator's row — the one the phone sent if it still holds this
  // elevator (rows shift when the sheet is edited), otherwise by OK # — and check
  // every step before the inspection is done (src/lib/inOrder.ts), on the
  // dashboard itself, so an out-of-order report is never made or sent. Only "no
  // such elevator" counts as not found; a busy Google is a "try again", never a
  // skipped check.
  let sheetRow: number | null;
  try {
    sheetRow = e.row
      ? await requireElevatorRow(e.row, e.okla).catch((err) => {
          if (err instanceof NoSuchRow) return null;
          throw err;
        })
      : await findRowByOkla(e.okla);
    if (!sheetRow) return Response.json({ error: `OK # ${e.okla} isn't on the dashboard, so its report can't be finished.` }, { status: 404 });
    const rw = await readRow(sheetRow);
    const why = inspectionBlocked({
      moneyPath: cell(rw, "moneyPath"),
      twoMoEmail: cell(rw, "twoMoEmail"),
      quote: cell(rw, "quote"),
      po: cell(rw, "po"),
      maintConfirm: cell(rw, "maintConfirm"),
      scheduling: cell(rw, "scheduling"),
      visit: cell(rw, "visit"),
      report: cell(rw, "report"),
    });
    if (why) return Response.json({ error: `Can't finish yet — ${why}. Every step before the inspection has to be done first.` }, { status: 409 });
  } catch {
    return Response.json({ error: "Couldn't check the dashboard just now — try again in a minute." }, { status: 502 });
  }

  const templatePath = path.join(process.cwd(), "templates", "inspection-form.pdf");
  const templateBytes = new Uint8Array(await readFile(templatePath));
  const pdf = await fillReport(templateBytes, payload);

  const { okla, account, building } = payload.elevator;
  const dateText = displayDate(payload.report.date);
  // "Lawton City: Oct 9, 2026 (TV Civic center).pdf" — see reportName.ts.
  const fileName = reportFileName(account ?? "", dateText, building ?? "", okla ?? "");

  // Flip the dashboard cells and save the PDF to Drive independently, so one
  // failing never blocks the other or loses the finished PDF.
  let writeback = "ok";
  try {
    await markInspected(sheetRow, dateText);
  } catch (err) {
    writeback = "failed: " + (err instanceof Error ? err.message : "unknown");
  }

  let driveLink = "";
  let drive = "ok";
  try {
    driveLink = await uploadFile(fileName, pdf, "application/pdf", account);
    // Keep the report's Drive link on the row (col AO) so the file is easy to find later.
    if (driveLink) await setReportFile(sheetRow, driveLink);
  } catch (err) {
    drive = "failed: " + (err instanceof Error ? err.message : "unknown");
  }

  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": dispositionFor("inline", fileName),
      "X-Drive-Link": driveLink,
      "X-Drive": drive,
      "X-Writeback": writeback,
    },
  });
}
