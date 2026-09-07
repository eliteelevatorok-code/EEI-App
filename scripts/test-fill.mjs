import { PDFDocument, PDFName, PDFBool } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "templates", "inspection-form.pdf");
const out = path.join(process.cwd(), "templates", "_filled-test.pdf");

const doc = await PDFDocument.load(fs.readFileSync(src), { updateMetadata: false });
const form = doc.getForm();

const text = {
  "DATE INSP": "9/6/2026",
  "OKLA #": "990001",
  "SERIAL NUMBER": "TX-449812",
  "PERMIT #": "OK-77120",
  "LOC BLDG": "Lawton Civic Center",
  "LOC PHYSICAL ADDRESS": "801 NW Ferris Ave",
  "LOC ZIP CODE": "73507",
  "EMAIL ADDRESS": "r.lassiter@example.com",
  "OWNER": "City of Lawton",
  "OWNER ADDRESS": "212 SW 9th St",
  "OWNER STATE": "OK",
  "MANUFACTURER": "Otis",
  "CAPACITY": "3000",
  "SPEED": "200",
  "RISE": "72 ft 4 in",
  "OPENINGS": "7",
  "LANDINGS": "7",
  "INSTALLED YEAR": "1998",
  "CODE YEAR": "2016",
  "LATEST TEST DATES ONE YEAR": "08/2026",
  "LATEST TEST DATES FIVE  YEAR": "08/2023",
};

let ok = 0;
const misses = [];
for (const [name, value] of Object.entries(text)) {
  try {
    form.getTextField(name).setText(value);
    ok++;
  } catch {
    misses.push(name);
  }
}

const checks = ["INSPECTION TYPE PERIODIC", "CERTIFICATE ISSUE YES NO", "NO ADVERSE CONDITIONS"];
for (const c of checks) {
  try {
    form.getCheckBox(c).check();
  } catch {
    misses.push("[cb] " + c);
  }
}
try {
  form.getRadioGroup("Insp Cycle").select("1"); // 1yr
} catch {
  misses.push("[radio] Insp Cycle");
}

// The form has JS buttons with broken appearances that crash pdf-lib's global
// appearance pass. Skip it and set NeedAppearances so viewers redraw the values.
form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
fs.writeFileSync(out, await doc.save({ updateFieldAppearances: false }));

// read back to verify
const check = await PDFDocument.load(fs.readFileSync(out));
const cf = check.getForm();
console.log("text fields set:", ok, "/", Object.keys(text).length);
console.log("misses:", misses.length ? misses.join(" | ") : "none");
console.log("read-back DATE INSP:", cf.getTextField("DATE INSP").getText());
console.log("read-back OKLA #:", cf.getTextField("OKLA #").getText());
console.log("read-back cert-issue checked:", cf.getCheckBox("CERTIFICATE ISSUE YES NO").isChecked());
console.log("read-back Insp Cycle:", cf.getRadioGroup("Insp Cycle").getSelected());
console.log("saved:", out, fs.statSync(out).size, "bytes");
