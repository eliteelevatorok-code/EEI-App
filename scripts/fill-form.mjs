// Full PDF fill from a report object, tested against the real master form.
// Uses a resolver so logical field names auto-match the real names even when
// they carry a ".0" suffix or extra spaces.
import { PDFDocument, PDFName, PDFBool } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "templates", "inspection-form.pdf");
const out = path.join(process.cwd(), "templates", "_filled-report.pdf");

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

function makeResolver(form) {
  const fields = form.getFields();
  const byExact = new Map(fields.map((f) => [f.getName(), f]));
  const byNorm = new Map();
  for (const f of fields) {
    const base = f.getName().replace(/\.\d+$/, "");
    for (const key of [norm(f.getName()), norm(base)]) {
      if (!byNorm.has(key)) byNorm.set(key, f);
    }
  }
  return (logical) => byExact.get(logical) || byNorm.get(norm(logical)) || null;
}

// ---- sample report (shape the app produces + the elevator's carried fields) ----
const report = {
  dateInsp: "9/6/2026",
  certExp: "9/6/2027",
  okla: "990001",
  serial: "TX-449812",
  permit: "OK-77120",
  inspCycle: "1", // 1 | 2 | 3 | Res
  locBldg: "Lawton Civic Center",
  locAddr: "801 NW Ferris Ave",
  locZip: "73507",
  email: "r.lassiter@example.com",
  owner: "City of Lawton",
  ownerAddr: "212 SW 9th St",
  ownerCity: "Lawton",
  ownerState: "OK",
  ownerZip: "73501",
  mfr: "Otis",
  capacity: "3000",
  speed: "200",
  rise: "72 ft 4 in",
  openings: "7",
  landings: "7",
  installed: "1998",
  codeYear: "2016",
  test1: "08/2026",
  test5: "08/2023",
  inspType: "Periodic",
  certIssue: "Yes",
  condition: "No adverse conditions",
  violations: [
    { text: "Access keys shall be provided -- 17.1-8.6.11.3,-MR", kind: "V" },
    { text: "Clean inside elevator controller -- 17.1-8.6.1.6.3b,-MR", kind: "R" },
  ],
};

const doc = await PDFDocument.load(fs.readFileSync(src), { updateMetadata: false });
const form = doc.getForm();
const resolve = makeResolver(form);

let set = 0;
const misses = [];

function text(logical, value) {
  if (value == null || value === "") return;
  const f = resolve(logical);
  if (f && f.constructor.name === "PDFTextField") {
    f.setText(String(value));
    set++;
  } else misses.push("text:" + logical);
}
function check(logical) {
  const f = resolve(logical);
  if (f && f.constructor.name === "PDFCheckBox") {
    f.check();
    set++;
  } else misses.push("cb:" + logical);
}
function radio(logical, opt) {
  const f = resolve(logical);
  if (f && f.constructor.name === "PDFRadioGroup") {
    try {
      f.select(opt);
      set++;
    } catch {
      misses.push("radio-opt:" + logical + "=" + opt);
    }
  } else misses.push("radio:" + logical);
}

// text fields
text("DATE INSP", report.dateInsp);
text("CERT DATE", report.certExp);
text("OKLA #", report.okla);
text("SERIAL NUMBER", report.serial);
text("PERMIT #", report.permit);
text("LOC BLDG", report.locBldg);
text("LOC PHYSICAL ADDRESS", report.locAddr);
text("LOC ZIP CODE", report.locZip);
text("EMAIL ADDRESS", report.email);
text("OWNER", report.owner);
text("OWNER ADDRESS", report.ownerAddr);
text("Owner City", report.ownerCity);
text("OWNER STATE", report.ownerState);
text("OWNER  ZIP CODE", report.ownerZip);
text("MANUFACTURER", report.mfr);
text("CAPACITY", report.capacity);
text("SPEED", report.speed);
text("RISE", report.rise);
text("OPENINGS", report.openings);
text("LANDINGS", report.landings);
text("INSTALLED YEAR", report.installed);
text("CODE YEAR", report.codeYear);
text("LATEST TEST DATES ONE YEAR", report.test1);
text("LATEST TEST DATES FIVE  YEAR", report.test5);

// inspection type checkbox
const inspTypeCb = {
  Initial: "INSPECTION TYPE INITAL",
  Periodic: "INSPECTION TYPE PERIODIC",
  Reinsp: "INSPECTION TYPE REINSP",
  "Follow-up": "INSPECTION TYPE FOLLOW",
  Witness: "INSPECTION TYPE WITNESS",
  Alteration: "INSPECTION TYPE ALTERATION",
};
if (inspTypeCb[report.inspType]) check(inspTypeCb[report.inspType]);

// certificate issue + condition
if (report.certIssue === "Yes") check("CERTIFICATE ISSUE YES NO");
if (report.condition === "No adverse conditions") check("NO ADVERSE CONDITIONS");
if (report.condition === "Red Tag") check("RED TAG");
if (report.condition === "Inactive") check("INACTIVE");
if (report.condition === "Scrapped") check("SCRAPPED");

// inspection cycle radio: 1/2/3, Res -> "0"
radio("Insp Cycle", report.inspCycle === "Res" ? "0" : report.inspCycle);

// violation lines: combo0.. hold the violation text (from the 261-option list)
report.violations.forEach((v, i) => {
  const f = resolve("combo" + i);
  if (f && f.constructor.name === "PDFDropdown") {
    try {
      f.select(v.text);
      set++;
    } catch {
      misses.push("combo" + i + " (option not found)");
    }
  } else misses.push("combo" + i);
});
// counts
text("VIOLATIONS", String(report.violations.filter((v) => v.kind === "V").length));
text("RECOMMENDATIONS", String(report.violations.filter((v) => v.kind === "R").length));

form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
fs.writeFileSync(out, await doc.save({ updateFieldAppearances: false }));

// verify
const chk = (await PDFDocument.load(fs.readFileSync(out))).getForm();
const rr = makeResolver(chk);
console.log("fields set:", set);
console.log("misses:", misses.length ? misses.join(" | ") : "none");
console.log("verify OKLA #:", rr("OKLA #")?.getText?.());
console.log("verify LOC BLDG:", rr("LOC BLDG")?.getText?.());
console.log("verify LANDINGS:", rr("LANDINGS")?.getText?.());
console.log("verify FIVE YEAR:", rr("LATEST TEST DATES FIVE  YEAR")?.getText?.());
console.log("verify combo0:", rr("combo0")?.getSelected?.());
console.log("verify Insp Cycle:", rr("Insp Cycle")?.getSelected?.());
console.log("saved:", fs.statSync(out).size, "bytes");
