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

export type AddedViolation = {
  raw: string;
  kind: LineKind;
  violation: string;
  recommendation: string;
  comment: string;
};

export type Field = { label: string; value: string };

export type Elevator = {
  okla: string;
  building: string;
  account: string;
  contact: string;
  area: string;
  city: string;
  type: string;
  floors: number;
  cycle: string; // "1" | "2" | "3" | "Res"
  due: string;
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

// Live data only — the roster comes from the dashboard via src/lib/roster.ts.
// (No sample/fake accounts ship in the app.)
