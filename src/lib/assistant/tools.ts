import { readRange } from "@/lib/google";
import { getInvoiceBalance } from "@/lib/quickbooks";
import { appendElevator, type NewElevatorInput } from "@/lib/roster";
import { FIRST_ROW, cell, readRows, writeRow, type Col } from "@/lib/sheet";
import { isMasterOn, setElevatorSwitch, setMaster } from "@/lib/switches";

// What the in-app assistant can do. Each tool is described to Claude (name,
// description, input shape) and has a function here that actually does it.
//
// READ tools run straight away. CHANGE tools never run on their own: the server
// stops, the app shows a Confirm / Cancel card built from `describe()`, and the
// change only happens after the person taps Confirm (see /api/assistant).
// Secrets in the Config tab (keys, tokens) are never readable by the assistant.

type Json = Record<string, unknown>;

// Plain-language meaning of every Elevators column the assistant may read/write.
const FIELD_HELP: Partial<Record<Col, string>> = {
  okla: "Oklahoma elevator number (the ID)",
  building: "Building name",
  area: "Area / region",
  city: "City",
  account: "Customer account (company)",
  contact: "Customer contact name",
  email: "Customer email (where the automation sends customer emails)",
  phone: "Customer phone",
  maintCo: "Maintenance company",
  maintContact: "Maintenance contact name",
  maintEmail: "Maintenance company email (gets the safety-test question when the company is American Elevator)",
  maintPhone: "Maintenance phone",
  type: "Equipment type, e.g. Elevator (Traction), Elevator (Hydraulic), Escalator, Wheelchair/Platform Lift",
  floors: "Number of floors",
  cycle: "Inspection cycle, e.g. 1 yr, 2 yr, 3 yr, Res",
  price: "Customer price, e.g. $250",
  moneyPath: "Quote to PO to invoice | Invoice only",
  due: "Next inspection due date (M/D/YYYY)",
  twoMoEmail: "Lifecycle: 2-month heads-up email (Sent)",
  quote: "Lifecycle: quote (Review | Sent)",
  po: "Lifecycle: purchase order (Awaiting | Received | N/A)",
  scheduling: "Lifecycle: scheduling email with booking link (Sent)",
  maintConfirm: "Lifecycle: safety-test question — has it passed a safety test in the last 12 months? (Waiting = asked, no answer yet | Answered | No answer)",
  accessReminder: "Lifecycle: access reminder email (Sent)",
  visit: "Lifecycle: visit (Booked | Inspected)",
  tripDay: "Lifecycle: trip day — the inspection date (M/D/YYYY)",
  report: "Lifecycle: report emailed to customer + ODOL (Sent)",
  invoice: "Lifecycle: QuickBooks invoice (Sent)",
  followUps: "Lifecycle: payment reminders (#1 sent | #2 sent | #3 sent)",
  paid: "Lifecycle: paid (Paid)",
  newTimer: "Lifecycle: next cycle set (Set)",
  notes: "Notes (free text)",
  poNumber: "Customer PO number",
  poFile: "Link to the customer's PO file",
  safetyTest: "Has the elevator had a passing safety test in the last 12 months? (Yes | No) — from the records form or entered by hand",
  safetyTestDate: "Date of that passing safety test (M/D/YYYY)",
  reportFile: "Drive link to the latest finished report",
  invoiceDate: "Day the invoice went out (the payment reminder waits 30 days from it)",
  active: "On/Off switch for this elevator (read-only here — use set_elevator_switch)",
};
// Columns the assistant may change with update_elevator. Not: the link token,
// the sheet's own "Next action" formula, the QuickBooks invoice id, or the
// on/off switch (which has its own tool and wording).
const EDITABLE: Col[] = (Object.keys(FIELD_HELP) as Col[]).filter((c) => c !== "active" && c !== "okla");
const READABLE = Object.keys(FIELD_HELP) as Col[];

// Public tool list sent to Claude.
export const TOOLS = [
  {
    name: "list_elevators",
    description:
      "Every elevator on the dashboard with ALL of its details (customer, contacts, maintenance company, type, floors, cycle, price, due date, every lifecycle step, trip day, invoice date, PO, safety test, notes, on/off). Optionally filter by a search word (matched against building, account, city, OK #, contact or maintenance company). Use this for any question across elevators — counts, money, who owes what, what's coming up, anything — and work the answer out yourself.",
    input_schema: { type: "object", properties: { search: { type: "string" } } },
  },
  {
    name: "get_elevator",
    description: "Everything on the dashboard for one elevator (every column, by name), plus its sheet row.",
    input_schema: { type: "object", properties: { okla: { type: "string", description: "The OK #" } }, required: ["okla"] },
  },
  {
    name: "get_overview",
    description:
      "The big picture right now: whether the whole system is running, what needs a person today (booked visits, maintenance to chase), overdue elevators, due within 30 days, and money (unpaid bills, being billed, paid, totals).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_invoice_balance",
    description: "Ask QuickBooks for the current balance of an elevator's invoice (0 = paid).",
    input_schema: { type: "object", properties: { okla: { type: "string" } }, required: ["okla"] },
  },
  {
    name: "read_email_wording",
    description: "The Emails tab of the dashboard: the wording notes for each automatic email.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_elevator",
    description:
      "CHANGE: set one or more fields on one elevator. Field names: " +
      EDITABLE.map((c) => `${c} (${FIELD_HELP[c]})`).join("; ") +
      ". Use an empty string to clear a field. Needs the person's confirmation in the app.",
    input_schema: {
      type: "object",
      properties: {
        okla: { type: "string" },
        changes: { type: "object", additionalProperties: { type: "string" }, description: "field name → new value" },
      },
      required: ["okla", "changes"],
    },
  },
  {
    name: "add_elevator",
    description:
      "CHANGE: add a new elevator to the dashboard. okla, building and account are required; any of these may be given: area, city, contact, email, phone, maintCo, maintContact, maintEmail, maintPhone, type, floors, cycle, price, moneyPath, due. Needs confirmation.",
    input_schema: {
      type: "object",
      properties: { fields: { type: "object", additionalProperties: { type: "string" } } },
      required: ["fields"],
    },
  },
  {
    name: "set_elevator_switch",
    description: "CHANGE: turn one elevator's automatic steps on (resume) or off (pause). Needs confirmation.",
    input_schema: {
      type: "object",
      properties: { okla: { type: "string" }, on: { type: "boolean" } },
      required: ["okla", "on"],
    },
  },
  {
    name: "set_master_switch",
    description:
      "CHANGE: turn the WHOLE system on or off. Off halts every automatic email, invoice and payment step for all elevators. Needs confirmation (two steps to turn off).",
    input_schema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];
export const isChange = (name: string) =>
  ["update_elevator", "add_elevator", "set_elevator_switch", "set_master_switch"].includes(name);

/* ---- helpers ------------------------------------------------------------------ */

const STAGE_KEYS: Col[] = [
  "twoMoEmail", "quote", "po", "scheduling", "maintConfirm", "accessReminder",
  "visit", "tripDay", "report", "invoice", "followUps", "paid", "newTimer",
];

// Find an elevator's row by OK # (case-insensitive, trimmed).
async function findRow(okla: string): Promise<{ row: number; cells: string[] } | null> {
  const want = String(okla ?? "").trim().toLowerCase();
  if (!want) return null;
  const rows = await readRows();
  const i = rows.findIndex((r) => cell(r, "okla").toLowerCase() === want);
  return i === -1 ? null : { row: FIRST_ROW + i, cells: rows[i] };
}

// A real elevator row: has an OK # and isn't the DEMO walkthrough row (OK #
// starting "DEMO"), which would otherwise creep into totals and lists and make
// two answers disagree. (get_elevator can still open it by its OK #.)
const isReal = (r: string[]) => !!cell(r, "okla") && !/^demo/i.test(cell(r, "okla"));

function named(cells: string[], cols: Col[]): Json {
  const out: Json = {};
  for (const c of cols) {
    const v = cell(cells, c);
    if (v) out[c] = v;
  }
  return out;
}

const days = (due: string) => {
  const m = due.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) ?? null;
  if (!m) return null;
  const d = new Date(+m[3], +m[1] - 1, +m[2]);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
};
const priceNum = (p: string) => Number(p.replace(/[^0-9.]/g, "")) || 0;

/* ---- running a tool ------------------------------------------------------------ */

// Run a READ tool, or a CHANGE tool the person has already confirmed.
// Returns plain data (JSON-able); throws with a readable message on problems.
export async function runTool(name: string, input: Json): Promise<unknown> {
  switch (name) {
    case "list_elevators": {
      // Every readable field for every elevator (blank fields left out to keep it
      // small) — so the assistant can answer any question, not just set ones.
      const q = String(input.search ?? "").trim().toLowerCase();
      const rows = (await readRows()).filter(isReal);
      return rows
        .filter((r) => !q || (["building", "account", "city", "okla", "contact", "maintCo"] as Col[]).some((c) => cell(r, c).toLowerCase().includes(q)))
        .map((r) => ({ ...named(r, READABLE), on: cell(r, "active").toLowerCase() !== "off" }));
    }
    case "get_elevator": {
      const hit = await findRow(String(input.okla));
      if (!hit) throw new Error(`No elevator with OK # ${input.okla}`);
      return { row: hit.row, ...named(hit.cells, READABLE), on: cell(hit.cells, "active").toLowerCase() !== "off" };
    }
    case "get_overview": {
      const [master, rows] = await Promise.all([isMasterOn(), readRows()]);
      const els = rows.filter(isReal);
      const brief = (r: string[]) => `${cell(r, "building")} (OK# ${cell(r, "okla")})`;
      const on = els.filter((r) => cell(r, "active").toLowerCase() !== "off");
      const notDone = (r: string[]) => cell(r, "visit") !== "Inspected";
      const unpaid = els.filter((r) => cell(r, "invoice") === "Sent" && cell(r, "paid") !== "Paid");
      const paid = els.filter((r) => cell(r, "paid") === "Paid");
      return {
        today: new Date().toDateString(),
        systemRunning: master,
        pausedElevators: els.filter((r) => cell(r, "active").toLowerCase() === "off").map(brief),
        needsYou: [
          ...on.filter((r) => cell(r, "visit") === "Booked").map((r) => `${brief(r)}: do the inspection (visit booked)`),
          ...on.filter((r) => cell(r, "maintConfirm") === "Waiting").map((r) => `${brief(r)}: safety test answer still missing`),
        ],
        overdue: on.filter((r) => (days(cell(r, "due")) ?? 1) < 0 && notDone(r)).map((r) => `${brief(r)} due ${cell(r, "due")}`),
        dueWithin30Days: on
          .filter((r) => {
            const d = days(cell(r, "due"));
            return d !== null && d >= 0 && d <= 30 && notDone(r);
          })
          .map((r) => `${brief(r)} due ${cell(r, "due")}`),
        money: {
          unpaid: unpaid.map((r) => `${brief(r)} ${cell(r, "price")}${cell(r, "followUps") ? ` (reminder ${cell(r, "followUps")})` : ""}`),
          unpaidTotal: unpaid.reduce((n, r) => n + priceNum(cell(r, "price")), 0),
          beingBilled: els.filter((r) => cell(r, "report") === "Sent" && cell(r, "invoice") !== "Sent").map(brief),
          paid: paid.map(brief),
          paidTotal: paid.reduce((n, r) => n + priceNum(cell(r, "price")), 0),
        },
      };
    }
    case "get_invoice_balance": {
      const hit = await findRow(String(input.okla));
      if (!hit) throw new Error(`No elevator with OK # ${input.okla}`);
      const id = cell(hit.cells, "invoiceId");
      if (!id) return { invoiced: false, note: "No QuickBooks invoice on this elevator yet." };
      return { invoiced: true, invoiceId: id, balance: await getInvoiceBalance(id) };
    }
    case "read_email_wording":
      return await readRange("Emails!A1:H60");
    case "update_elevator": {
      const hit = await findRow(String(input.okla));
      if (!hit) throw new Error(`No elevator with OK # ${input.okla}`);
      const changes = cleanChanges(input.changes);
      await writeRow(hit.row, changes);
      return { ok: true, row: hit.row, changed: changes };
    }
    case "add_elevator": {
      const f = (input.fields ?? {}) as Record<string, unknown>;
      const keys: (keyof NewElevatorInput)[] = [
        "okla", "building", "area", "city", "account", "contact", "email", "phone", "maintCo",
        "maintContact", "maintEmail", "maintPhone", "type", "floors", "cycle", "price", "moneyPath", "due",
      ];
      const clean = {} as NewElevatorInput;
      for (const k of keys) clean[k] = String(f[k] ?? "").slice(0, 200).trim();
      if (!clean.okla || !clean.building || !clean.account) throw new Error("OK #, building and account are required");
      if (await findRow(clean.okla)) throw new Error(`OK # ${clean.okla} is already on the dashboard`);
      return { ok: true, row: await appendElevator(clean) };
    }
    case "set_elevator_switch": {
      const hit = await findRow(String(input.okla));
      if (!hit) throw new Error(`No elevator with OK # ${input.okla}`);
      await setElevatorSwitch(hit.row, Boolean(input.on));
      return { ok: true, on: Boolean(input.on) };
    }
    case "set_master_switch":
      await setMaster(Boolean(input.on));
      return { ok: true, systemRunning: Boolean(input.on) };
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// Only known, editable fields; values as short strings.
function cleanChanges(raw: unknown): Partial<Record<Col, string>> {
  const out: Partial<Record<Col, string>> = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!EDITABLE.includes(k as Col)) throw new Error(`"${k}" can't be changed here`);
    out[k as Col] = String(v ?? "").slice(0, 500);
  }
  if (!Object.keys(out).length) throw new Error("No changes given");
  return out;
}

// The Confirm card for a CHANGE tool: a title, one line per change (before →
// after), and whether it's the dangerous kind (red, two taps).
export type ChangeCard = { title: string; lines: string[]; danger: boolean };
export async function describe(name: string, input: Json): Promise<ChangeCard> {
  const label = (c: string) => (FIELD_HELP[c as Col] ?? c).replace(/^Lifecycle: /, "").split(" (")[0];
  switch (name) {
    case "update_elevator": {
      const hit = await findRow(String(input.okla));
      if (!hit) return { title: `Change OK # ${input.okla}`, lines: ["(not found on the dashboard)"], danger: false };
      const changes = cleanChanges(input.changes);
      return {
        title: `Change ${cell(hit.cells, "building")}`,
        lines: Object.entries(changes).map(([c, v]) => {
          const was = cell(hit.cells, c as Col);
          return `${label(c)}: ${was || "blank"} → ${v || "blank"}`;
        }),
        danger: false,
      };
    }
    case "add_elevator": {
      const f = (input.fields ?? {}) as Record<string, unknown>;
      return {
        title: `Add ${String(f.building ?? "a new elevator")}`,
        lines: Object.entries(f)
          .filter(([, v]) => String(v ?? "").trim())
          .map(([k, v]) => `${label(k)}: ${String(v)}`),
        danger: false,
      };
    }
    case "set_elevator_switch": {
      const hit = await findRow(String(input.okla));
      const b = hit ? cell(hit.cells, "building") : `OK # ${input.okla}`;
      return input.on
        ? { title: `Resume ${b}`, lines: ["Its automatic steps start running again."], danger: false }
        : { title: `Pause ${b}`, lines: ["Its automatic emails, invoice and payment steps stop until it's turned back on."], danger: true };
    }
    case "set_master_switch":
      return input.on
        ? { title: "Resume the whole system", lines: ["Automatic steps start again for every elevator that's switched on."], danger: false }
        : { title: "Pause the WHOLE system", lines: ["Every automatic email, invoice and payment step stops for all elevators."], danger: true };
    default:
      return { title: name, lines: [], danger: false };
  }
}

export const STAGES_FOR_PROMPT = STAGE_KEYS.map((c) => `${c} = ${FIELD_HELP[c]}`).join("\n");
