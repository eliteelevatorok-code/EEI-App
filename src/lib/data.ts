// Sample data for the field UI. Nothing here is a real customer — these mirror
// the dashboard's test rows. Real records will load from the dashboard later.

export type LineKind = "V" | "R" | "C";

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
