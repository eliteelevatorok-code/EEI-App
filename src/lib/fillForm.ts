import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFWidgetAnnotation,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  translate,
  type PDFObject,
  PDFRadioGroup,
  PDFRef,
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
    tempCert?: string; // "No" | "30 days" | "60 days" — temporary certificate of operation
    condition: string;
    notes: string;
    added: AddedViolation[]; // violations picked from the list (each may carry a comment)
    recommendations?: string[]; // typed by the inspector
    comments?: string[]; // typed by the inspector
  };
};

// The form's 36 numbered lines (8 on page 1, 28 on page 2): each has a type box
// (V1…, R1…, C1…) and a line that takes a list item or typed text.
export const FORM_LINES = 36;
type FormLine = { tag: string; text: string };
export function formLines(r: FinalizePayload["report"]): { lines: FormLine[]; v: number; rec: number; com: number } {
  const lines: FormLine[] = [];
  let v = 0, rec = 0, com = 0;
  const comment = (t: string) => t.trim() && lines.push({ tag: `C${++com}`, text: t.trim() });
  for (const a of r.added) {
    // Older drafts could mark a list item as a recommendation or comment.
    if (a.kind === "R") lines.push({ tag: `R${++rec}`, text: a.raw });
    else if (a.kind === "C") comment(a.raw);
    else lines.push({ tag: `V${++v}`, text: a.raw });
    comment(a.comment); // a line's own comment goes right under it
  }
  for (const t of r.recommendations ?? []) if (t.trim()) lines.push({ tag: `R${++rec}`, text: t.trim() });
  for (const t of r.comments ?? []) comment(t);
  return { lines, v, rec, com };
}

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
const pad = (n: number) => String(n).padStart(2, "0");
// The form's formats, as Robert writes them: 10/12/2026 and 10/2028.
const fmtDate = (o: Ymd) => `${pad(o.mo)}/${pad(o.d)}/${o.y}`;
const fmtMonthYear = (o: Ymd) => `${pad(o.mo)}/${o.y}`;
function addDays(o: Ymd, days: number): Ymd {
  const d = new Date(Date.UTC(o.y, o.mo - 1, o.d + days));
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

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
  // A Yes/No pair that is ONE checkbox with two boxes on the form (Certificate
  // issue, Temp): tick the box whose state is `state` ("Yes" or "No").
  const tick = (logical: string, state: "Yes" | "No") => {
    const f = resolve(logical);
    if (!(f instanceof PDFCheckBox)) return;
    // (pdf-lib's own setter only knows the first box's state, so set it by hand:
    // the field's value, and each box shown on or off.)
    const want = PDFName.of(state);
    const boxes = f.acroField.getWidgets();
    if (!boxes.some((w) => w.getOnValue() === want)) return; // no such box — leave it blank
    f.acroField.dict.set(PDFName.of("V"), want);
    for (const w of boxes) w.setAppearanceState(w.getOnValue() === want ? want : PDFName.of("Off"));
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
  text("LOC ATTENTION", e.contact); // Robert puts the customer contact here too
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
  // "Company Name" by the signature is the CUSTOMER's company (as on Robert's own reports).
  text("COMPANY NAME", e.account && e.account !== "Unassigned" ? e.account : e.building);
  text("QEI #", INSPECTOR.qei);
  text("OK St Lic #", INSPECTOR.license);

  // this visit
  const temp = r.tempCert === "30 days" || r.tempCert === "60 days";
  const issued = r.certIssue === "Yes";
  const dt = parseDate(r.date);
  if (dt) {
    text("DATE INSP", fmtDate(dt));
    // Certificate expiry (MO/YEAR): issued → inspection date + cycle years (Res
    // treated as 1); temporary → + 30 or 60 days; neither (inactive…) → blank.
    const yrs = r.cycle === "Res" ? 1 : parseInt(r.cycle, 10) || 1;
    if (issued) text("CERT DATE", fmtMonthYear({ ...dt, y: dt.y + yrs }));
    else if (temp) text("CERT DATE", fmtMonthYear(addDays(dt, r.tempCert === "30 days" ? 30 : 60)));
  } else {
    text("DATE INSP", r.date);
  }
  text("LATEST TEST DATES ONE YEAR", r.test1);
  text("LATEST TEST DATES FIVE  YEAR", r.test5);
  if (INSP_TYPE_CB[r.inspType]) check(INSP_TYPE_CB[r.inspType]);
  pick("Insp Cycle", r.cycle === "Res" ? "0" : r.cycle);
  // Certificate ISSUE and TEMP are always ticked one way or the other. A
  // temporary certificate also ticks "TEMP CERT OF OPERATION □30 □60" at the top
  // (the form calls its two options "Yes" = 30 and "No" = 60).
  if (r.certIssue === "Yes" || r.certIssue === "No") tick("CERTIFICATE ISSUE YES NO", r.certIssue);
  tick("CERTIFICATE TEMP YESNO", temp ? "Yes" : "No");
  if (temp) pick("Temp30/60", r.tempCert === "30 days" ? "Yes" : "No");
  // Certificate goes TO the owner when a separate owner is listed, otherwise the
  // location — only when there IS a certificate (none for inactive and the like).
  if (issued || temp) check(carriedValue("Owner") ? "CERTIFICATE TO OWNER" : "CERTIFICATE TO LOCATION");
  if (r.condition === "No adverse conditions") check("NO ADVERSE CONDITIONS");
  if (r.condition === "Red Tag") check("RED TAG");
  if (r.condition === "Inactive") check("INACTIVE");
  if (r.condition === "Scrapped") check("SCRAPPED");

  // Violations / recommendations / comments, one per numbered line: the type box
  // (VRC.0–7 on page 1, VRC9.0–27 on page 2) gets V1/R1/C1…, the line itself
  // (combo0–35) the list item's exact wording or the typed text — both boxes
  // accept typed values. A violation's comment is its own C line right under it.
  const { lines, v: nV, rec: nR } = formLines(r);
  lines.slice(0, FORM_LINES).forEach((l, i) => {
    pick("combo" + i, l.text);
    pick(i < 8 ? `VRC.${i}` : `VRC9.${i - 8}`, l.tag);
  });
  text("VIOLATIONS", String(nV));
  text("RECOMMENDATIONS", String(nR));

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
  flattenForm(doc);
  return doc.save({ updateFieldAppearances: false });
}

// FLATTEN (2026-10-15): stamp every filled-in box onto the page itself as plain
// printed content and remove the form. Some PDF viewers (the one Gmail opens
// attachments in, among others) ignore or redraw form boxes and showed the
// finished report completely blank; a flattened page looks the same everywhere.
// A finished report is final anyway — it isn't meant to be edited.
// The form's script buttons (Reset, File Save…) are dropped, not stamped.
// (pdf-lib's own form.flatten() breaks on this form, so it's done by hand: draw
// each box's picture where the box sits, then remove the boxes and the form.)
export function flattenForm(doc: PDFDocument): void {
  const buttons = new Set<PDFDict>();
  for (const f of doc.getForm().getFields()) {
    if (f instanceof PDFButton) for (const w of f.acroField.getWidgets()) buttons.add(w.dict);
  }
  const HIDDEN = 2;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict) || dict.get(PDFName.of("Subtype")) !== PDFName.of("Widget")) {
        keep.push(ref); // links and other notes stay
        continue;
      }
      if (buttons.has(dict)) continue;
      const flags = dict.lookup(PDFName.of("F"));
      if (flags instanceof PDFNumber && flags.asNumber() & HIDDEN) continue;
      try {
        const widget = PDFWidgetAnnotation.fromDict(dict);
        let ap: PDFObject | undefined = widget.getNormalAppearance();
        if (ap instanceof PDFDict) {
          // A check box / radio: the drawing for its current state (checked or off).
          const state = widget.getAppearanceState() ?? PDFName.of("Off");
          ap = ap.get(state) ?? ap.get(PDFName.of("Off"));
        }
        if (!(ap instanceof PDFRef)) continue;
        const r = widget.getRectangle();
        const key = page.node.newXObject("FlatWidget", ap);
        page.pushOperators(pushGraphicsState(), translate(r.x, r.y), drawObject(key), popGraphicsState());
      } catch {
        /* no drawing for this box — nothing to stamp */
      }
    }
    page.node.set(PDFName.of("Annots"), doc.context.obj(keep));
  }
  doc.catalog.delete(PDFName.of("AcroForm"));
}
