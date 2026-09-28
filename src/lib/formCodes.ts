// The state form's radio-button groups store a hidden number for each choice.
// These maps turn the label shown in the app into that number. They're the single
// list used by BOTH the "New elevator" screen (its choices) and the PDF filler
// (src/lib/fillForm.ts). Codes were read off the real form on 2026-09-07 —
// `node scripts/inspect-pdf.mjs` shows them.

export const DEVICE_TYPE_CODE: Record<string, string> = {
  "Const/Temp": "0",
  "Escalator/MW": "1",
  "Personnel Hoist": "2",
  "Platform Lift": "3",
  "Stairway Chair Lift": "4",
  Passenger: "5",
  "LU/LA": "6",
  Freight: "7",
};

export const MACHINE_TYPE_CODE: Record<string, string> = {
  Cable: "1",
  "Direct Plunger Hydraulic": "2",
  "Hand Powered": "3",
  "Roped Hydraulic": "4",
  Other: "5",
};

export const ENTITY_TYPE_CODE: Record<string, string> = {
  Private: "1",
  County: "2",
  City: "3",
  State: "4",
};
