import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

const p = process.argv[2];
const bytes = fs.readFileSync(p);
const head = Buffer.from(bytes.slice(0, 5)).toString();
const form = (await PDFDocument.load(bytes)).getForm();
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const find = (logical) =>
  form.getFields().find((f) => norm(f.getName().replace(/\.\d+$/, "")) === norm(logical));
const t = (n) => find(n)?.getText?.();
const d = (n) => find(n)?.getSelected?.();
console.log("header:", head, "| size:", bytes.length);
console.log("OKLA #:", t("OKLA #"));
console.log("LOC BLDG:", t("LOC BLDG"));
console.log("MANUFACTURER:", t("MANUFACTURER"));
console.log("DATE INSP:", t("DATE INSP"));
console.log("CERT DATE:", t("CERT DATE"));
console.log("INSPECTORS NAMES:", t("INSPECTORS NAMES"));
console.log("QEI #:", t("QEI #"), "| OK St Lic #:", t("OK St Lic #"), "| COMPANY:", t("COMPANY NAME"));
console.log("Insp Cycle:", d("Insp Cycle"));
console.log("combo0:", d("combo0"));
console.log("combo1:", d("combo1"));
console.log("# Violations:", t("VIOLATIONS"), "| # Recommendations:", t("RECOMMENDATIONS"));
