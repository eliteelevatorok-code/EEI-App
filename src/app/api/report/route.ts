import { readFile } from "node:fs/promises";
import path from "node:path";
import { cell, findByToken } from "@/lib/sheet";

export const runtime = "nodejs";

// Public, token-keyed: /api/report?t=<token> returns the inspection report PDF so
// the Make automation can attach it to the customer and ODOL "report filed"
// emails (route 6). Nothing is saved anywhere — it's served on demand.
// For now it returns the state's blank master form as a stand-in for the
// finished report; a fully filled per-elevator PDF can slot in here later.
export async function GET(req: Request) {
  const hit = await findByToken(new URL(req.url).searchParams.get("t") ?? "");
  if (!hit) return new Response("not found", { status: 404 });
  const okla = cell(hit.cells, "okla") || "elevator";
  const bytes = await readFile(path.join(process.cwd(), "templates", "inspection-form.pdf"));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="inspection-report-${okla}.pdf"`,
    },
  });
}
