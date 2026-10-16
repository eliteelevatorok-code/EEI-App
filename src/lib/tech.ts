// The elevator's fixed details the STATE FORM needs (equipment, owner, location).
// They're saved on the dashboard (columns AQ–BK and BU–BX, one per detail) so
// they're entered once and reused on every report, every year. Edited on the
// "New elevator" screen, on the elevator's profile ("For the state form"), by the
// assistant, on the report screen (only the missing ones), or straight on the
// dashboard.
//
// `key` is the dashboard column name (see COL in sheet.ts), `label` is what the
// app shows, `pdf` is the state form's own box name (see fillForm.ts), and
// `kind` says how it's filled: a text box, or one of the form's pick lists.
// `need` says when Finish requires it — read off Robert's own finished reports
// (2026-10-15): "always" = on every report he files; "owner" = only when a
// separate owner is listed; none = usually left as the form's dashes.
// Listed in the order the boxes sit on the form.

export type TechKind = "text" | "device" | "machine" | "entity" | "county";
export type TechKey =
  | "serial" | "permit" | "manufacturer" | "capacity" | "speed" | "rise" | "openings" | "landings"
  | "deviceType" | "machineType" | "installedYear" | "codeYear" | "entityType"
  | "owner" | "ownerAddress" | "ownerCity" | "ownerState" | "ownerZip" | "ownerAttention"
  | "locationAddress" | "locationZip" | "county"
  | "natureOfBusiness" | "hoistwayLocation" | "deviceLocation";

export type TechNeed = "always" | "owner";

export const TECH: { key: TechKey; label: string; pdf: string; kind: TechKind; need?: TechNeed; hint?: string }[] = [
  { key: "serial", label: "Serial number", pdf: "SERIAL NUMBER", kind: "text", need: "always" },
  { key: "permit", label: "Permit #", pdf: "PERMIT #", kind: "text" },
  { key: "locationAddress", label: "Location address", pdf: "LOC PHYSICAL ADDRESS", kind: "text", need: "always", hint: "Street address of the building" },
  { key: "locationZip", label: "Location zip", pdf: "LOC ZIP CODE", kind: "text", need: "always" },
  { key: "county", label: "County", pdf: "COUNTY", kind: "county", need: "always" },
  { key: "owner", label: "Owner", pdf: "OWNER", kind: "text", hint: "Only if the owner is a different company — otherwise leave blank" },
  { key: "ownerAttention", label: "Owner attention", pdf: "OWNER ATTENTION", kind: "text", need: "owner" },
  { key: "ownerAddress", label: "Owner address", pdf: "OWNER ADDRESS", kind: "text", need: "owner" },
  { key: "ownerCity", label: "Owner city", pdf: "Owner City", kind: "text", need: "owner" },
  { key: "ownerState", label: "Owner state", pdf: "OWNER STATE", kind: "text", need: "owner" },
  { key: "ownerZip", label: "Owner zip", pdf: "OWNER  ZIP CODE", kind: "text", need: "owner" },
  { key: "natureOfBusiness", label: "Nature of business", pdf: "NATURE OF BUSINESS", kind: "text", need: "always", hint: "e.g. Hospital/Medical, Apts/Hotels, University" },
  { key: "entityType", label: "Entity type", pdf: "Entity Type", kind: "entity", need: "always" },
  { key: "hoistwayLocation", label: "Hoistway location", pdf: "HOISTWAY LOCATION", kind: "text", need: "always", hint: "e.g. Lobby, South Building" },
  { key: "deviceLocation", label: "Device location in hoistway", pdf: "DEVICE LOCATION IN HOISTWAY", kind: "text", need: "always", hint: "e.g. Single, Duplex, West Car #1" },
  { key: "manufacturer", label: "Manufacturer", pdf: "MANUFACTURER", kind: "text", need: "always" },
  { key: "capacity", label: "Capacity (lbs)", pdf: "CAPACITY", kind: "text", need: "always" },
  { key: "speed", label: "Speed (FPM)", pdf: "SPEED", kind: "text", need: "always" },
  { key: "rise", label: "Rise", pdf: "RISE", kind: "text", need: "always", hint: "Feet and inches, e.g. 44'0\"" },
  { key: "openings", label: "Openings", pdf: "OPENINGS", kind: "text", need: "always" },
  { key: "landings", label: "# of landings", pdf: "LANDINGS", kind: "text", need: "always" },
  { key: "deviceType", label: "Device type", pdf: "Device Type", kind: "device", need: "always" },
  { key: "machineType", label: "Machine type", pdf: "Machine Type", kind: "machine", need: "always" },
  { key: "installedYear", label: "Installed year", pdf: "INSTALLED YEAR", kind: "text", need: "always" },
  { key: "codeYear", label: "Code year", pdf: "CODE YEAR", kind: "text", need: "always", hint: "e.g. A17.1-2016" },
];

export const TECH_KEYS = TECH.map((t) => t.key);
export const techLabel = (key: TechKey) => TECH.find((t) => t.key === key)?.label ?? key;

// The customer's own details that print on the state form too (location
// attention, email, city, and the contact line by the signature). They live in
// the dashboard's first columns; Finish needs every one of them.
export type BasicKey = "contact" | "phone" | "email" | "city";
export const FORM_BASICS: { key: BasicKey; label: string }[] = [
  { key: "contact", label: "Contact name" },
  { key: "phone", label: "Contact phone" },
  { key: "email", label: "Customer email" },
  { key: "city", label: "City" },
];
export const BASIC_KEYS = FORM_BASICS.map((b) => b.key);

// What an elevator is still missing for the state form, as Robert fills it.
// `details` = the elevator's saved details by label (Elevator.carried).
export function missingForForm(
  basics: Partial<Record<BasicKey, string>>,
  details: { label: string; value: string }[],
): { key: TechKey | BasicKey; label: string }[] {
  const val = (label: string) => details.find((d) => d.label === label)?.value.trim() ?? "";
  const hasOwner = !!val(techLabel("owner"));
  return [
    ...FORM_BASICS.filter((b) => !basics[b.key]?.trim()),
    ...TECH.filter((t) => (t.need === "always" || (t.need === "owner" && hasOwner)) && !val(t.label)),
  ].map((x) => ({ key: x.key, label: x.label }));
}
