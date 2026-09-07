import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const pdfPath = path.join(process.cwd(), "templates", "inspection-form.pdf");
const bytes = fs.readFileSync(pdfPath);
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const form = doc.getForm();
const fields = form.getFields();

// group by base name (strip a trailing .<number>)
const groups = new Map();
for (const f of fields) {
  const name = f.getName();
  const base = name.replace(/\.\d+$/, "");
  const type = f.constructor.name;
  if (!groups.has(base)) {
    let opts = "";
    if (type === "PDFRadioGroup" || type === "PDFDropdown") {
      const o = f.getOptions();
      opts = `${o.length} opts: ${o.slice(0, 6).map((x) => x.trim() || "(blank)").join(",")}${o.length > 6 ? ",…" : ""}`;
    }
    groups.set(base, { type, count: 0, opts });
  }
  groups.get(base).count++;
}
console.log("pages:", doc.getPageCount(), "total fields:", fields.length, "families:", groups.size);
console.log("----");
for (const [base, g] of [...groups.entries()].sort()) {
  console.log(`${g.type}  x${g.count}  ::  ${base}${g.opts ? "  [" + g.opts + "]" : ""}`);
}
