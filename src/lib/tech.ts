// The elevator's fixed details the STATE FORM needs (equipment, owner, location).
// They're saved on the dashboard (columns AQ–BK, one per detail) so they're
// entered once and reused on every report, every year. Edited on the "New
// elevator" screen, on the elevator's profile ("For the state form"), by the
// assistant, or straight on the dashboard. Locked on the report screen itself.
//
// `key` is the dashboard column name (see COL in sheet.ts), `label` is what the
// app shows, `pdf` is the state form's own box name (see fillForm.ts), and
// `kind` says how it's filled: a text box, or one of the form's pick lists.

export type TechKind = "text" | "device" | "machine" | "entity" | "county";
export type TechKey =
  | "serial" | "permit" | "manufacturer" | "capacity" | "speed" | "rise" | "openings" | "landings"
  | "deviceType" | "machineType" | "installedYear" | "codeYear" | "entityType"
  | "owner" | "ownerAddress" | "ownerCity" | "ownerState" | "ownerZip"
  | "locationAddress" | "locationZip" | "county";

export const TECH: { key: TechKey; label: string; pdf: string; kind: TechKind; hint?: string }[] = [
  { key: "serial", label: "Serial number", pdf: "SERIAL NUMBER", kind: "text" },
  { key: "permit", label: "Permit #", pdf: "PERMIT #", kind: "text" },
  { key: "manufacturer", label: "Manufacturer", pdf: "MANUFACTURER", kind: "text" },
  { key: "capacity", label: "Capacity (lbs)", pdf: "CAPACITY", kind: "text" },
  { key: "speed", label: "Speed (FPM)", pdf: "SPEED", kind: "text" },
  { key: "rise", label: "Rise", pdf: "RISE", kind: "text" },
  { key: "openings", label: "Openings", pdf: "OPENINGS", kind: "text" },
  { key: "landings", label: "# of landings", pdf: "LANDINGS", kind: "text" },
  { key: "deviceType", label: "Device type", pdf: "Device Type", kind: "device" },
  { key: "machineType", label: "Machine type", pdf: "Machine Type", kind: "machine" },
  { key: "installedYear", label: "Installed year", pdf: "INSTALLED YEAR", kind: "text" },
  { key: "codeYear", label: "Code year", pdf: "CODE YEAR", kind: "text" },
  { key: "entityType", label: "Entity type", pdf: "Entity Type", kind: "entity" },
  { key: "owner", label: "Owner", pdf: "OWNER", kind: "text" },
  { key: "ownerAddress", label: "Owner address", pdf: "OWNER ADDRESS", kind: "text" },
  { key: "ownerCity", label: "Owner city", pdf: "Owner City", kind: "text" },
  { key: "ownerState", label: "Owner state", pdf: "OWNER STATE", kind: "text" },
  { key: "ownerZip", label: "Owner zip", pdf: "OWNER  ZIP CODE", kind: "text" },
  { key: "locationAddress", label: "Location address", pdf: "LOC PHYSICAL ADDRESS", kind: "text", hint: "Street address of the building" },
  { key: "locationZip", label: "Location zip", pdf: "LOC ZIP CODE", kind: "text" },
  { key: "county", label: "County", pdf: "COUNTY", kind: "county" },
];

export const TECH_KEYS = TECH.map((t) => t.key);
export const techLabel = (key: TechKey) => TECH.find((t) => t.key === key)?.label ?? key;
