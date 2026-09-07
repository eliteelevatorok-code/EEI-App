import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import fs from "node:fs";

const bytes = fs.readFileSync("templates/inspection-form.pdf");
const doc = await PDFDocument.load(bytes);
const form = doc.getForm();
const pages = doc.getPages();

for (const name of ["Device Type", "Machine Type", "Entity Type", "Insp Cycle"]) {
  const f = form.getField(name);
  console.log("\n===", name, "  options:", f.getOptions?.() ?? f.acroField.getExportValues?.());
  for (const w of f.acroField.getWidgets()) {
    const r = w.getRectangle();
    // find the "on" state: the /AP /N key that isn't Off
    let on = "?";
    const ap = w.dict.lookup(PDFName.of("AP"));
    if (ap instanceof PDFDict) {
      const n = ap.lookup(PDFName.of("N"));
      if (n instanceof PDFDict) {
        for (const [k] of n.entries()) {
          const key = k.decodeText ? k.decodeText() : k.toString();
          if (key !== "/Off" && key !== "Off") on = key.replace(/^\//, "");
        }
      }
    }
    console.log(`  code="${on}"  x=${Math.round(r.x)} y=${Math.round(r.y)}`);
  }
}
