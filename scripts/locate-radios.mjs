import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

const bytes = fs.readFileSync("templates/inspection-form.pdf");
const doc = await PDFDocument.load(bytes);
const form = doc.getForm();
const pages = doc.getPages();
const pageIndex = (ref) => pages.findIndex((p) => p.ref === ref);

for (const name of ["Device Type", "Machine Type", "Entity Type", "Insp Cycle"]) {
  const f = form.getFields().find((x) => x.getName() === name);
  if (!f) { console.log(name, "NOT FOUND"); continue; }
  console.log("\n===", name, "===");
  for (const w of f.acroField.getWidgets()) {
    const r = w.getRectangle();
    const pRef = w.P();
    let pi = -1;
    for (let i = 0; i < pages.length; i++) if (pages[i].ref === pRef) pi = i;
    // option export value for this widget
    let onVal = "";
    try {
      const ap = w.getAppearances?.();
      const dict = w.dict.get(w.dict.context.obj("AS").constructor ? undefined : undefined);
    } catch {}
    console.log(`  page ${pi + 1}  x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}`);
  }
}
