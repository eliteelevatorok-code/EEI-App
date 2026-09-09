import { uploadFile } from "@/lib/google";
import { findByToken, recordPO } from "@/lib/po";

export const runtime = "nodejs";

// GET /api/po?t=<token> → { building, okla, alreadyPO } so the page can greet
// the customer with their building name. Never reveals anything without the token.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const el = await findByToken(token);
  if (!el) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ building: el.building, okla: el.okla, alreadyPO: el.alreadyPO });
}

// POST (multipart form): token, po, optional file → writes the PO into the row
// and files any attachment in the account's Drive folder.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Bad form data" }, { status: 400 });
  }
  const token = String(form.get("token") ?? "");
  const po = String(form.get("po") ?? "").trim();
  const file = form.get("file");

  if (!po) return Response.json({ error: "Please enter your PO number." }, { status: 400 });
  if (po.length > 120) return Response.json({ error: "That PO number looks too long." }, { status: 400 });

  const el = await findByToken(token);
  if (!el) return Response.json({ error: "This link isn't recognized." }, { status: 404 });

  let fileLink = "";
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > 15 * 1024 * 1024) {
      return Response.json({ error: "That file is over 15 MB — please send a smaller one." }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safeName = `PO-${el.okla}-${po}`.replace(/[^\w.-]/g, "_");
    const ext = (file.name.match(/\.[a-zA-Z0-9]{1,6}$/) || [""])[0];
    try {
      fileLink = await uploadFile(safeName + ext, bytes, file.type || "application/octet-stream", el.account);
    } catch {
      // Don't lose the PO number just because the attachment failed to store.
      fileLink = "";
    }
  }

  try {
    await recordPO(el.row, po, fileLink);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return Response.json({ error: message }, { status: 502 });
  }
  return Response.json({ ok: true, fileSaved: Boolean(fileLink) });
}
