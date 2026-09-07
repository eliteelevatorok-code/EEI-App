import { PDFDocument, PDFName, PDFBool, type PDFForm, type PDFField } from "pdf-lib";
import type { Elevator, AddedViolation } from "@/lib/data";

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
  // Device type / Machine type are numeric-coded radios — mapped once codes are confirmed.
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

  const text = (logical: string, value?: string) => {
    if (!value) return;
    const f = resolve(logical);
    if (f && f.constructor.name === "PDFTextField") (f as never as { setText(v: string): void }).setText(value);
  };
  const check = (logical: string) => {
    const f = resolve(logical);
    if (f && f.constructor.name === "PDFCheckBox") (f as never as { check(): void }).check();
  };
  const radio = (logical: string, opt: string) => {
    const f = resolve(logical);
    if (f && f.constructor.name === "PDFRadioGroup") {
      try {
        (f as never as { select(o: string): void }).select(opt);
      } catch {
        /* option not present */
      }
    }
  };

  // identity / location from the elevator
  text("OKLA #", e.okla);
  text("LOC BLDG", e.building);
  text("EMAIL ADDRESS", e.contact ? undefined : undefined); // email lives on the row; wire when roster is live
  // carried fixed fields
  const carriedValue = (label: string) => e.carried.find((c) => c.label === label)?.value ?? "";
  for (const c of e.carried) {
    const field = CARRIED_TO_FIELD[c.label];
    if (field) text(field, c.value);
  }

  // numeric-coded radios (device / machine / entity type)
  const deviceCode = DEVICE_TYPE_CODE[carriedValue("Device type")];
  if (deviceCode) radio("Device Type", deviceCode);
  const machineCode = MACHINE_TYPE_CODE[carriedValue("Machine type")];
  if (machineCode) radio("Machine Type", machineCode);
  const entityCode = ENTITY_TYPE_CODE[carriedValue("Entity type")];
  if (entityCode) radio("Entity Type", entityCode);

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
  radio("Insp Cycle", r.cycle === "Res" ? "0" : r.cycle);
  if (r.certIssue === "Yes") check("CERTIFICATE ISSUE YES NO");
  if (r.condition === "No adverse conditions") check("NO ADVERSE CONDITIONS");
  if (r.condition === "Red Tag") check("RED TAG");
  if (r.condition === "Inactive") check("INACTIVE");
  if (r.condition === "Scrapped") check("SCRAPPED");

  // violation lines: combo0.. hold the violation text (from the 261-option list)
  r.added.forEach((v: AddedViolation, i: number) => {
    const f = resolve("combo" + i);
    if (f && f.constructor.name === "PDFDropdown") {
      try {
        (f as never as { select(o: string): void }).select(v.raw);
      } catch {
        /* not one of the listed options */
      }
    }
  });
  text("VIOLATIONS", String(r.added.filter((v) => v.kind === "V").length));
  text("RECOMMENDATIONS", String(r.added.filter((v) => v.kind === "R").length));

  // JS buttons in the form break the global appearance pass — flag the viewer to redraw.
  (form as never as { acroForm: { dict: { set(k: unknown, v: unknown): void } } }).acroForm.dict.set(
    PDFName.of("NeedAppearances"),
    PDFBool.True,
  );
  return doc.save({ updateFieldAppearances: false });
}
