import { readConfig, writeConfig } from "@/lib/config";

// The QuickBooks Online engine. It creates the customer invoice and, once the
// real company is connected, tells QuickBooks to send its own official bill
// (PDF + pay-online button).
//
// TWO COMPANIES, chosen by what's in the private Config tab:
//   - the TEST company (Intuit's free sandbox), using the development keys —
//     devClientId / devClientSecret / sandboxRealmId / qbRefreshToken. Development
//     keys physically cannot reach the real company.
//   - the REAL company, once Robert has (1) put his production keys in Config as
//     qbClientId / qbClientSecret and (2) tapped Settings → QuickBooks → Connect,
//     which signs him in on Intuit's own page and saves qbRealmId /
//     qbRealRefreshToken (see /api/quickbooks/connect). No key ever passes through
//     the chat or the app's screens.
// The real company is used as soon as it's connected; the test company otherwise.

const SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const REAL_BASE = "https://quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QB_SCOPE = "com.intuit.quickbooks.accounting";
const MINOR = "minorversion=75";
const ITEM_NAME = "Elevator Inspection";

type Setup = {
  real: boolean;
  base: string;
  clientId: string;
  clientSecret: string;
  realmId: string;
  refreshToken: string;
  refreshKey: string; // the Config row the refresh token lives in
};

// Which company, and its keys, from the Config tab.
async function qbSetup(): Promise<Setup> {
  const c = await readConfig();
  const g = (k: string) => c.get(k) ?? "";
  if (g("qbClientId") && g("qbRealRefreshToken") && g("qbRealmId")) {
    return {
      real: true,
      base: REAL_BASE,
      clientId: g("qbClientId"),
      clientSecret: g("qbClientSecret"),
      realmId: g("qbRealmId"),
      refreshToken: g("qbRealRefreshToken"),
      refreshKey: "qbRealRefreshToken",
    };
  }
  return {
    real: false,
    base: SANDBOX_BASE,
    clientId: g("devClientId"),
    clientSecret: g("devClientSecret"),
    realmId: g("sandboxRealmId"),
    refreshToken: g("qbRefreshToken"),
    refreshKey: "qbRefreshToken",
  };
}

// True while billing runs against the fake test company.
export async function isSandbox(): Promise<boolean> {
  return !(await qbSetup()).real;
}

// The production keys, for the Connect sign-in (empty if Robert hasn't added them).
export async function realKeys(): Promise<{ clientId: string; clientSecret: string }> {
  const c = await readConfig();
  return { clientId: c.get("qbClientId") ?? "", clientSecret: c.get("qbClientSecret") ?? "" };
}

// For Settings: is the real company connected, and are the production keys in Config?
export async function qbStatus(): Promise<{ real: boolean; haveKeys: boolean }> {
  const [sandbox, k] = await Promise.all([isSandbox(), realKeys()]);
  return { real: !sandbox, haveKeys: !!(k.clientId && k.clientSecret) };
}

// Connect, step 2: swap Intuit's one-time code for the long-lived sign-in and
// save it (and the company id) to Config. From then on billing uses the real company.
export async function finishConnect(code: string, realmId: string, redirectUri: string): Promise<void> {
  const k = await realKeys();
  if (!k.clientId || !k.clientSecret) throw new Error("QuickBooks production keys are missing from Config");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${k.clientId}:${k.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  const tok = (await res.json()) as { refresh_token?: string; error?: string };
  if (!res.ok || !tok.refresh_token) throw new Error(`QuickBooks connect failed (${res.status}): ${tok.error ?? "unknown"}`);
  await writeConfig("qbRealmId", realmId);
  await writeConfig("qbRealRefreshToken", tok.refresh_token);
  accessCache = null; // the next call signs in to the real company
}

// Cache the short-lived access token in memory (it lasts ~60 min) — per company,
// so connecting the real company never reuses a test-company token.
type Access = { token: string; realmId: string; base: string };
let accessCache: (Access & { real: boolean; expires: number }) | null = null;

// A valid access token, refreshing it when it's close to expiring. Only one
// refresh runs at a time: two requests refreshing with the same token at once is
// a known cause of QuickBooks "invalid_grant" failures.
let refreshing: Promise<Access> | null = null;
async function getAccess(): Promise<Access> {
  const real = !(await isSandbox());
  if (accessCache && accessCache.real === real && accessCache.expires > Date.now() + 60_000) {
    return { token: accessCache.token, realmId: accessCache.realmId, base: accessCache.base };
  }
  refreshing ??= refreshAccess().finally(() => (refreshing = null));
  return refreshing;
}

// Exchange the stored refresh token for an access token. The refresh token
// rotates now and then, so the moment QuickBooks hands back a new one we save it
// to Config — otherwise the next run would try to use a dead token. If the token
// was just used up by another copy of the app (the server can run several at
// once), re-read Config once: that copy will have saved the new one.
async function refreshAccess(retried = false): Promise<Access> {
  const cfg = await qbSetup();
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
    if (!retried && tok.error === "invalid_grant") {
      await new Promise((r) => setTimeout(r, 1500)); // give the other copy time to save the new token
      return refreshAccess(true);
    }
    throw new Error(`QuickBooks sign-in failed (${res.status}): ${tok.error ?? "unknown"}`);
  }
  if (tok.refresh_token && tok.refresh_token !== cfg.refreshToken) {
    await writeConfig(cfg.refreshKey, tok.refresh_token);
  }
  accessCache = {
    token: tok.access_token,
    realmId: cfg.realmId,
    base: cfg.base,
    real: cfg.real,
    expires: Date.now() + (tok.expires_in ?? 3600) * 1000,
  };
  return { token: accessCache.token, realmId: accessCache.realmId, base: accessCache.base };
}

// One call to the QuickBooks API, with auth and the required minor version.
async function qb<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const { token, realmId, base } = await getAccess();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${base}/v3/company/${realmId}/${path}${sep}${MINOR}`;
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
    body: { Name: ITEM_NAME, Type: "Service", IncomeAccountRef: { value: accounts[0].Id } },
  });
  return res.Item;
}

type InvoiceInput = {
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
    CustomerRef: { value: customer.Id },
    Line: [
      {
        Amount: input.amount,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: 1, UnitPrice: input.amount },
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
// to the customer. This is the real send once the real company is connected. The
// sandbox accepts the call but does not deliver a real email.
export async function sendInvoice(id: string, email?: string): Promise<void> {
  const q = email ? `invoice/${id}/send?sendTo=${encodeURIComponent(email)}` : `invoice/${id}/send`;
  await qb(q, { method: "POST" });
}

// QuickBooks' own pay-online page for an invoice (real company, with QuickBooks
// Payments turned on, after QuickBooks has emailed it). Empty if there isn't one.
export async function getInvoicePayLink(id: string): Promise<string> {
  const res = await qb<{ Invoice: Invoice & { InvoiceLink?: string } }>(`invoice/${id}?include=invoiceLink`);
  const link = res.Invoice.InvoiceLink ?? "";
  return link.startsWith("https://") ? link : "";
}

// Read one invoice's current balance. Balance 0 = fully paid.
export async function getInvoiceBalance(id: string): Promise<number> {
  const res = await qb<{ Invoice: Invoice }>(`invoice/${id}`);
  return res.Invoice.Balance;
}
