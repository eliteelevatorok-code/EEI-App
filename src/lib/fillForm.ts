import {
  PDFBool,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  type PDFField,
  type PDFForm,
} from "pdf-lib";
import type { Elevator, AddedViolation } from "@/lib/data";
import { DEVICE_TYPE_CODE, ENTITY_TYPE_CODE, MACHINE_TYPE_CODE } from "@/lib/formCodes";
import { TECH } from "@/lib/tech";

// Fills Oklahoma DOL's official third-party inspection form
// (templates/inspection-form.pdf) from one finished report. Field names below are
// the form's own internal names — run `node scripts/inspect-pdf.mjs` to list them.

export type FinalizePayload = {
  elevator: Elevator;
  report: {
    date: string;
    inspType: string;
    cycle: string;
    test1: string;
    test5: string;
    certIssue: string;
    condition: string;
    notes: string;
    added: AddedViolation[];
  };
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Resolve a logical field name to the real field even when it carries a ".0"
// suffix or extra spaces in the master form.
function makeResolver(form: PDFForm) {
  const fields = form.getFields();
  const byExact = new Map(fields.map((f) => [f.getName(), f]));
  const byNorm = new Map<string, PDFField>();
  for (const f of fields) {
    const base = f.getName().replace(/\.\d+$/, "");
    for (const key of [norm(f.getName()), norm(base)]) {
      if (!byNorm.has(key)) byNorm.set(key, f);
    }
  }
  return (logical: string) => byExact.get(logical) || byNorm.get(norm(logical)) || null;
}


// Inspection type → the checkbox that marks it on the form.
const INSP_TYPE_CB: Record<string, string> = {
  Initial: "INSPECTION TYPE INITAL",
  Periodic: "INSPECTION TYPE PERIODIC",
  Reinsp: "INSPECTION TYPE REINSP",
  "Follow-up": "INSPECTION TYPE FOLLOW",
  Witness: "INSPECTION TYPE WITNESS",
  Alteration: "INSPECTION TYPE ALTERATION",
};

// Robert's fixed inspector details — same on every report (from the handoff + rate card).
const INSPECTOR = {
  name: "Robert Lassiter",
  company: "Elite Elevator Inspections, LLC",
  qei: "C-5407",
  license: "40012",
};

type Ymd = { y: number; mo: number; d: number };
function parseDate(s?: string): Ymd | null {
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { y: +m[3], mo: +m[1], d: +m[2] };
  return null;
}
const fmtDate = (o: Ymd) => `${o.mo}/${o.d}/${o.y}`;

export async function fillReport(templateBytes: Uint8Array, p: FinalizePayload): Promise<Uint8Array> {
  const doc = await PDFDocument.load(templateBytes, { updateMetadata: false });
  const form = doc.getForm();
  const resolve = makeResolver(form);
  const { elevator: e, report: r } = p;

  // Small setters that silently skip a field if it's missing or the wrong kind,
  // so one odd field never stops the whole report. (`instanceof`, not the class
  // name — the production build shortens class names, which would break a name check.)
  const text = (logical: string, value?: string) => {
    const f = resolve(logical);
    if (value && f instanceof PDFTextField) f.setText(value);
  };
  const check = (logical: string) => {
    const f = resolve(logical);
    if (f instanceof PDFCheckBox) f.check();
  };
  const pick = (logical: string, option: string) => {
    const f = resolve(logical);
    if (!(f instanceof PDFRadioGroup || f instanceof PDFDropdown)) return;
    try {
      f.select(option);
    } catch {
      /* that option isn't on the form — leave it blank */
    }
  };

  // A pick list (city, county): choose the form's own entry that matches the
  // name, ignoring capitals and a trailing "County". No match → leave blank.
  const pickByName = (logical: string, name?: string) => {
    const f = resolve(logical);
    const want = norm(String(name ?? "").replace(/\s+county$/i, ""));
    if (!want || !(f instanceof PDFDropdown)) return;
    const hit = f.getOptions().find((o) => norm(o) === want);
    if (hit) f.select(hit);
  };

  // identity / location / contact from the elevator
  text("OKLA #", e.okla);
  text("LOC BLDG", e.building);
  text("EMAIL ADDRESS", e.email);
  text("CONTACT PERSON", e.contact);
  text("CONTACT PHONE NUMBER", e.phone);
  pickByName("CITY_NAME", e.city);

  // the saved state-form details (serial, permit, owner, … — see src/lib/tech.ts)
  const carriedValue = (label: string) => e.carried.find((c) => c.label === label)?.value ?? "";
  for (const t of TECH) {
    const v = carriedValue(t.label);
    if (!v) continue; // blank → the form's own default stays
    if (t.kind === "text") text(t.pdf, v);
    else if (t.kind === "county") pickByName(t.pdf, v);
    else {
      // numeric-coded radio buttons (device / machine / entity type)
      const code = (t.kind === "device" ? DEVICE_TYPE_CODE : t.kind === "machine" ? MACHINE_TYPE_CODE : ENTITY_TYPE_CODE)[v];
      if (code) pick(t.pdf, code);
    }
  }

  // fixed inspector details (same every report)
  text("INSPECTORS NAMES", INSPECTOR.name);
  text("COMPANY NAME", INSPECTOR.company);
  text("QEI #", INSPECTOR.qei);
  text("OK St Lic #", INSPECTOR.license);

  // this visit
  const dt = parseDate(r.date);
  if (dt) {
    text("DATE INSP", fmtDate(dt));
    // certificate expiry = inspection date + cycle years (Res treated as 1)
    const yrs = r.cycle === "Res" ? 1 : parseInt(r.cycle, 10) || 1;
    text("CERT DATE", fmtDate({ ...dt, y: dt.y + yrs }));
  } else {
    text("DATE INSP", r.date);
  }
  text("LATEST TEST DATES ONE YEAR", r.test1);
  text("LATEST TEST DATES FIVE  YEAR", r.test5);
  if (INSP_TYPE_CB[r.inspType]) check(INSP_TYPE_CB[r.inspType]);
  pick("Insp Cycle", r.cycle === "Res" ? "0" : r.cycle);
  if (r.certIssue === "Yes") check("CERTIFICATE ISSUE YES NO");
  if (r.condition === "No adverse conditions") check("NO ADVERSE CONDITIONS");
  if (r.condition === "Red Tag") check("RED TAG");
  if (r.condition === "Inactive") check("INACTIVE");
  if (r.condition === "Scrapped") check("SCRAPPED");

  // Violation lines: dropdowns combo0, combo1, … each pick one line from the
  // form's built-in 261-item list (the app's list uses the exact same wording).
  // Note: the official form has no box for per-line comments, so those stay in the app.
  r.added.forEach((v: AddedViolation, i: number) => pick("combo" + i, v.raw));
  text("VIOLATIONS", String(r.added.filter((v) => v.kind === "V").length));
  text("RECOMMENDATIONS", String(r.added.filter((v) => v.kind === "R").length));

  // Draw the filled-in values into the PDF. pdf-lib's "redraw every field" step
  // crashes on the form's built-in script buttons, so instead we redraw only the
  // fields we changed, one at a time, skipping any that can't be drawn. Many PDF
  // viewers (email previews, phone viewers) ignore the "please redraw" flag
  // below, and without drawn values they show blank boxes.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const f of form.getFields()) {
    try {
      // (Buttons are skipped entirely — even asking them if they need drawing crashes.)
      if (f instanceof PDFTextField || f instanceof PDFDropdown) {
        if (f.needsAppearancesUpdate()) f.defaultUpdateAppearances(font);
      } else if (f instanceof PDFCheckBox || f instanceof PDFRadioGroup) {
        if (f.needsAppearancesUpdate()) f.defaultUpdateAppearances();
      }
    } catch {
      /* this field can't be drawn by pdf-lib — the flag below still covers other viewers */
    }
  }
  // Also ask viewers that do honor it (Acrobat, Chrome) to redraw everything.
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return doc.save({ updateFieldAppearances: false });
}
