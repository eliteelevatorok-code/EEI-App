import { readFile } from "node:fs/promises";
import path from "node:path";
import { findByToken } from "@/lib/maint";

export const runtime = "nodejs";

// Public, token-keyed: serves the inspection report PDF for a row so the
// automation can attach it to the customer and ODOL emails — no copy saved
// anywhere, it's generated/served on demand. (For now it returns the master
// report form as the stand-in finished report; a fully-filled per-row PDF can
// slot in here later.)
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const el = await findByToken(t);
  if (!el) return new Response("not found", { status: 404 });
  const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "templates", "inspection-form.pdf")));
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="inspection-report-${el.okla || "elevator"}.pdf"`,
    },
  });
}
