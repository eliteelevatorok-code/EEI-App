import {
  PDFBool,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFRadioGroup,
  PDFTextField,
  type PDFField,
  type PDFForm,
} from "pdf-lib";
import type { Elevator, AddedViolation } from "@/lib/data";

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

// carried "label" (from the dashboard/app) -> master-form field name
const CARRIED_TO_FIELD: Record<string, string> = {
  "Serial number": "SERIAL NUMBER",
  "Permit #": "PERMIT #",
  Manufacturer: "MANUFACTURER",
  "Capacity (lbs)": "CAPACITY",
  "Speed (FPM)": "SPEED",
  Rise: "RISE",
  Openings: "OPENINGS",
  "# of landings": "LANDINGS",
  "Installed year": "INSTALLED YEAR",
  "Code year": "CODE YEAR",
  Owner: "OWNER",
  "Owner address": "OWNER ADDRESS",
  "Location address": "LOC PHYSICAL ADDRESS",
  // Device / Machine / Entity type are radio buttons, filled separately below.
};

// Numeric-coded radio groups on the master form. Codes read off the real
// form (2026-09-07): the label printed beside each box → its hidden value.
const DEVICE_TYPE_CODE: Record<string, string> = {
  "Const/Temp": "0",
  "Escalator/MW": "1",
  "Personnel Hoist": "2",
  "Platform Lift": "3",
  "Stairway Chair Lift": "4",
  Passenger: "5",
  "LU/LA": "6",
  Freight: "7",
};
const MACHINE_TYPE_CODE: Record<string, string> = {
  Cable: "1",
  "Direct Plunger Hydraulic": "2",
  "Hand Powered": "3",
  "Roped Hydraulic": "4",
  Other: "5",
};
const ENTITY_TYPE_CODE: Record<string, string> = {
  Private: "1",
  County: "2",
  City: "3",
  State: "4",
};

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

  // identity / location from the elevator
  text("OKLA #", e.okla);
  text("LOC BLDG", e.building);
  text("EMAIL ADDRESS", e.email);
  // carried fixed fields
  const carriedValue = (label: string) => e.carried.find((c) => c.label === label)?.value ?? "";
  for (const c of e.carried) {
    const field = CARRIED_TO_FIELD[c.label];
    if (field) text(field, c.value);
  }

  // numeric-coded radios (device / machine / entity type)
  const deviceCode = DEVICE_TYPE_CODE[carriedValue("Device type")];
  if (deviceCode) pick("Device Type", deviceCode);
  const machineCode = MACHINE_TYPE_CODE[carriedValue("Machine type")];
  if (machineCode) pick("Machine Type", machineCode);
  const entityCode = ENTITY_TYPE_CODE[carriedValue("Entity type")];
  if (entityCode) pick("Entity Type", entityCode);

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

  // The form contains script buttons that crash pdf-lib's "redraw every field"
  // step, so we skip that step and instead tell the PDF viewer to redraw the
  // fields itself when it opens the file.
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return doc.save({ updateFieldAppearances: false });
}
