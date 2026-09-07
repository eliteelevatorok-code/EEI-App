import { readFile } from "node:fs/promises";
import path from "node:path";
import { fillReport, type FinalizePayload } from "@/lib/fillForm";
import { uploadPdf } from "@/lib/google";
import { findRowByOkla, markInspected } from "@/lib/roster";

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

  const templatePath = path.join(process.cwd(), "templates", "inspection-form.pdf");
  const templateBytes = new Uint8Array(await readFile(templatePath));
  const pdf = await fillReport(templateBytes, payload);

  const { okla, row, account } = payload.elevator;
  const dateText = displayDate(payload.report.date);
  const fileName = `report-${okla || "unknown"}-${dateText.replace(/\//g, "-")}.pdf`;

  // Flip the dashboard cells and save the PDF to Drive independently, so one
  // failing never blocks the other or loses the finished PDF.
  let writeback = "ok";
  try {
    const sheetRow = row ?? (okla ? await findRowByOkla(okla) : null);
    if (sheetRow) await markInspected(sheetRow, dateText);
    else writeback = "no-matching-row";
  } catch (err) {
    writeback = "failed: " + (err instanceof Error ? err.message : "unknown");
  }

  let driveLink = "";
  let drive = "ok";
  try {
    driveLink = await uploadPdf(fileName, pdf, account);
  } catch (err) {
    drive = "failed: " + (err instanceof Error ? err.message : "unknown");
  }

  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "X-Drive-Link": driveLink,
      "X-Drive": drive,
      "X-Writeback": writeback,
    },
  });
}
