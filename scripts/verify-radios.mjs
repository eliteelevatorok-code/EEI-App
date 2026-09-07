import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

const bytes = fs.readFileSync(process.argv[2]);
const form = (await PDFDocument.load(bytes)).getForm();
const sel = (n) => {
  try { return form.getRadioGroup(n).getSelected(); } catch { return "(none)"; }
};
console.log("Device Type code:", sel("Device Type"));
console.log("Machine Type code:", sel("Machine Type"));
console.log("Entity Type code:", sel("Entity Type"));
console.log("Insp Cycle code:", sel("Insp Cycle"));
