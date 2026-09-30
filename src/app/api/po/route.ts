import { uploadFile } from "@/lib/google";
import { findForPO, recordPO } from "@/lib/po";

export const runtime = "nodejs";

// Vercel turns away any upload over 4.5 MB before this code even runs, so keep
// the limit under that (PoForm checks the same number before sending).
const MAX_PO_FILE = 4 * 1024 * 1024;

// GET /api/po?t=<token> → { building, okla, alreadyPO } so the page can greet
// the customer with their building name. Never reveals anything without the token.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const el = await findForPO(token);
  if (!el) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ building: el.building, okla: el.okla, alreadyPO: el.alreadyPO, invoiced: el.invoiced });
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
  if (/[<>]/.test(po)) return Response.json({ error: "Please leave out the < and > characters." }, { status: 400 });

  const el = await findForPO(token);
  if (!el) return Response.json({ error: "This link isn't recognized." }, { status: 404 });
  // Once the invoice has gone out with a PO on it, the link can't change it.
  if (el.invoiced && el.alreadyPO && el.alreadyPO !== po) {
    return Response.json({ error: "Your invoice has already gone out with PO " + el.alreadyPO + ". To change it, please reply to our email or call (405) 213-9779." }, { status: 409 });
  }

  let fileLink = "";
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX_PO_FILE) {
      return Response.json({ error: "That file is over 4 MB — please send a smaller one." }, { status: 400 });
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
  } catch {
    // Public page: never show outsiders the internal error.
    return Response.json({ error: "Couldn't save just now — please try again in a minute." }, { status: 502 });
  }
  return Response.json({ ok: true, fileSaved: Boolean(fileLink) });
}
