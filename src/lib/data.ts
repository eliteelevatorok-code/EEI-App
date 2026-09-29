// Types + constants for the field app. Live records come from the dashboard
// via src/lib/roster.ts — no sample data ships here.

export type LineKind = "V" | "R" | "C";

// One stage of the customer lifecycle (a dashboard column S..AE). `col` is the
// sheet column letter, used to write the stage back. `options` are the dropdown
// choices for that cell (empty = free text).
export type LifecycleStage = {
  key: string;
  label: string;
  col: string;
  value: string;
  options: string[];
};

// One line the inspector added to a report. `raw` is the exact text from the
// violation list (it's also the option value on the state form's dropdowns);
// `kind` is Violation / Recommendation / Comment.
export type AddedViolation = {
  raw: string;
  kind: LineKind;
  violation: string;
  comment: string;
};

export type Field = { label: string; value: string };

export type Elevator = {
  okla: string;
  building: string;
  account: string;
  contact: string;
  email?: string; // customer email (col G) — also printed on the state form
  phone?: string; // customer phone (col H)
  maintCo?: string; // maintenance company (cols I–L): name, contact, email, phone
  maintContact?: string;
  maintEmail?: string;
  maintPhone?: string;
  area: string;
  city: string;
  type: string;
  floors: number;
  cycle: string; // "1" | "2" | "3" | "Res"
  due: string;
  price?: string; // customer price from the dashboard (col P)
  moneyPath?: string; // col Q
  active?: boolean; // the on/off switch (col AL); false = paused
  row?: number; // the dashboard sheet row this came from (for write-back)
  lifecycle: LifecycleStage[]; // the customer-lifecycle status cells (cols S..AE)
  carried: Field[]; // fixed info: shown, but locked on the phone
  lastYear: {
    date: string;
    inspType: string;
    test1: string;
    test5: string;
    certIssue: string;
    condition: string;
    notes: string;
  };
};

export type Account = { name: string; units: Elevator[] };

export const INSPECTION_TYPES = ["Initial", "Periodic", "Reinsp", "Follow-up", "Witness", "Alteration"];
export const CYCLES = ["1", "2", "3", "Res"];
export const CERT_ISSUE = ["Yes", "No"];
export const CONDITIONS = ["No adverse conditions", "Red Tag", "Inactive", "Scrapped"];
