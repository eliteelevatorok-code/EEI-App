import { readRange, writeCell } from "@/lib/google";

// The QuickBooks Online engine. It creates the customer invoice and, in
// production, tells QuickBooks to send its own official bill (PDF + pay-online).
//
// Everything below talks to the SANDBOX by default — the free fake company —
// using the development keys stored in the private "Config" tab. Development
// keys physically cannot reach the real company, so this is safe to run.
// Flip to production later by setting QB_BASE to the live URL and swapping the
// keys in Config for production keys.

const QB_BASE = process.env.QB_BASE ?? "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR = "minorversion=75";
const ITEM_NAME = "Elevator Inspection";

type QBConfig = { clientId: string; clientSecret: string; realmId: string; refreshToken: string };

// Read the four QuickBooks keys from the Config tab (label in A, value in B).
async function readConfig(): Promise<QBConfig> {
  const rows = await readRange("Config!A1:B12");
  const map = new Map(rows.map((r) => [(r[0] ?? "").trim(), (r[1] ?? "").trim()]));
  return {
    clientId: map.get("devClientId") ?? "",
    clientSecret: map.get("devClientSecret") ?? "",
    realmId: map.get("sandboxRealmId") ?? "",
    refreshToken: map.get("qbRefreshToken") ?? "",
  };
}

// Save a value back into a Config row, found by its label in column A.
async function writeConfig(label: string, value: string): Promise<void> {
  const rows = await readRange("Config!A1:A12");
  const i = rows.findIndex((r) => (r[0] ?? "").trim() === label);
  if (i === -1) throw new Error(`Config row "${label}" not found`);
  await writeCell(`Config!B${i + 1}`, value);
}

// Cache the short-lived access token in memory (it lasts ~60 min).
let accessCache: { token: string; realmId: string; expires: number } | null = null;

// Exchange the stored refresh token for an access token. The refresh token
// rotates on use, so the moment QuickBooks hands back a new one we save it to
// Config — otherwise the next run would try to use a dead token.
async function getAccess(): Promise<{ token: string; realmId: string }> {
  if (accessCache && accessCache.expires > Date.now() + 60_000) {
    return { token: accessCache.token, realmId: accessCache.realmId };
  }
  const cfg = await readConfig();
  if (!cfg.clientId || !cfg.refreshToken) throw new Error("QuickBooks keys are missing from Config");
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken }),
  });
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !tok.access_token) {
    throw new Error(`QuickBooks sign-in failed (${res.status}): ${tok.error ?? "unknown"}`);
  }
  if (tok.refresh_token && tok.refresh_token !== cfg.refreshToken) {
    await writeConfig("qbRefreshToken", tok.refresh_token);
  }
  accessCache = {
    token: tok.access_token,
    realmId: cfg.realmId,
    expires: Date.now() + (tok.expires_in ?? 3600) * 1000,
  };
  return { token: accessCache.token, realmId: accessCache.realmId };
}

// One call to the QuickBooks API, with auth and the required minor version.
async function qb<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const { token, realmId } = await getAccess();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${QB_BASE}/v3/company/${realmId}/${path}${sep}${MINOR}`;
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const fault = (json as { Fault?: { Error?: { Message?: string; Detail?: string }[] } }).Fault;
    const msg = fault?.Error?.[0]?.Detail ?? fault?.Error?.[0]?.Message ?? `HTTP ${res.status}`;
    throw new Error(`QuickBooks: ${msg}`);
  }
  return json as T;
}

// A QuickBooks query (SELECT ...). Returns the named entity array (may be empty).
async function query<T>(select: string, entity: string): Promise<T[]> {
  const res = await qb<{ QueryResponse?: Record<string, T[]> }>(`query?query=${encodeURIComponent(select)}`);
  return res.QueryResponse?.[entity] ?? [];
}

type Ref = { value: string };
type Customer = { Id: string; DisplayName: string };
type Item = { Id: string; Name: string };
type Account = { Id: string; Name: string; AccountType: string };
export type Invoice = { Id: string; SyncToken: string; Balance: number; TotalAmt: number; DocNumber?: string };

// Find a customer by exact display name, or create one. Names must be unique in
// QuickBooks, so we always search first and only create when missing.
async function findOrCreateCustomer(displayName: string, email: string): Promise<Customer> {
  const safe = displayName.replace(/'/g, "\\'");
  const found = await query<Customer>(`SELECT * FROM Customer WHERE DisplayName = '${safe}'`, "Customer");
  if (found.length) return found[0];
  const body: Record<string, unknown> = { DisplayName: displayName };
  if (email) body.PrimaryEmailAddr = { Address: email };
  const res = await qb<{ Customer: Customer }>("customer", { method: "POST", body });
  return res.Customer;
}

// Find the "Elevator Inspection" service item, or create it against the first
// income account. Every invoice line must point at an item.
async function findOrCreateItem(): Promise<Item> {
  const safe = ITEM_NAME.replace(/'/g, "\\'");
  const found = await query<Item>(`SELECT * FROM Item WHERE Name = '${safe}'`, "Item");
  if (found.length) return found[0];
  const accounts = await query<Account>("SELECT * FROM Account WHERE AccountType = 'Income'", "Account");
  if (!accounts.length) throw new Error("No income account in QuickBooks to attach the item to");
  const res = await qb<{ Item: Item }>("item", {
    method: "POST",
    body: { Name: ITEM_NAME, Type: "Service", IncomeAccountRef: { value: accounts[0].Id } as Ref },
  });
  return res.Item;
}

export type InvoiceInput = {
  customerName: string;
  email: string;
  amount: number;
  memo?: string; // e.g. the building name + PO number
  dueDate?: string; // YYYY-MM-DD
};

// Create an invoice for one amount to one customer. Returns the new invoice.
export async function createInvoice(input: InvoiceInput): Promise<Invoice> {
  if (!(input.amount > 0)) throw new Error(`Invoice amount must be positive (got ${input.amount})`);
  const customer = await findOrCreateCustomer(input.customerName, input.email);
  const item = await findOrCreateItem();
  const body: Record<string, unknown> = {
    CustomerRef: { value: customer.Id } as Ref,
    Line: [
      {
        Amount: input.amount,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ItemRef: { value: item.Id } as Ref, Qty: 1, UnitPrice: input.amount },
      },
    ],
  };
  if (input.email) body.BillEmail = { Address: input.email };
  if (input.dueDate) body.DueDate = input.dueDate;
  if (input.memo) body.CustomerMemo = { value: input.memo };
  const res = await qb<{ Invoice: Invoice }>("invoice", { method: "POST", body });
  return res.Invoice;
}

// Tell QuickBooks to email its own official invoice (PDF + pay-online buttons)
// to the customer. This is the real send in production. The sandbox accepts the
// call but does not deliver a real email — that is expected in testing.
export async function sendInvoice(id: string, email?: string): Promise<void> {
  const q = email ? `invoice/${id}/send?sendTo=${encodeURIComponent(email)}` : `invoice/${id}/send`;
  await qb(q, { method: "POST" });
}

// Read one invoice's current balance. Balance 0 = fully paid.
export async function getInvoiceBalance(id: string): Promise<number> {
  const res = await qb<{ Invoice: Invoice }>(`invoice/${id}`);
  return res.Invoice.Balance;
}

// Delete an invoice (used only to clean up verification runs in the sandbox).
export async function deleteInvoice(id: string): Promise<void> {
  const cur = await qb<{ Invoice: Invoice }>(`invoice/${id}`);
  await qb("invoice?operation=delete", {
    method: "POST",
    body: { Id: id, SyncToken: cur.Invoice.SyncToken },
  });
}
