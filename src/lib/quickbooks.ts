import { readConfig, writeConfig } from "@/lib/config";
import { appendRow } from "@/lib/google";
import { seal, unseal } from "@/lib/secretBox";

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
export const QB_SCOPE = "com.intuit.quickbooks.accounting";
// A connection QuickBooks no longer accepts (expired, or disconnected from the
// QuickBooks side): this Config row says which company needs signing in again,
// so Settings shows a Reconnect button. Cleared by a successful Connect.
const NEEDS_RECONNECT = "qbNeedsReconnect";

// Intuit's sign-in addresses, from Intuit's own discovery document (as Intuit
// asks), kept for a day. If it can't be read, the long-standing addresses are used.
type Endpoints = { authorize: string; token: string };
const FALLBACK: Endpoints = {
  authorize: "https://appcenter.intuit.com/connect/oauth2",
  token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
};
const DISCOVERY = {
  real: "https://developer.api.intuit.com/.well-known/openid_configuration",
  test: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
};
const endpointCache: Partial<Record<"real" | "test", { e: Endpoints; until: number }>> = {};
export async function endpoints(real: boolean): Promise<Endpoints> {
  const k = real ? "real" : "test";
  const hit = endpointCache[k];
  if (hit && hit.until > Date.now()) return hit.e;
  try {
    const res = await fetch(DISCOVERY[k], { headers: { Accept: "application/json" } });
    const d = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
    if (res.ok && d.authorization_endpoint?.startsWith("https://") && d.token_endpoint?.startsWith("https://")) {
      const e = { authorize: d.authorization_endpoint, token: d.token_endpoint };
      endpointCache[k] = { e, until: Date.now() + 24 * 60 * 60 * 1000 };
      return e;
    }
  } catch {
    /* use the fallback below */
  }
  return FALLBACK;
}
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
  unreadable: boolean; // the saved sign-in couldn't be decrypted
};

// Which company, and its keys, from the Config tab. The sign-in (refresh token
// and company id) is stored encrypted — see secretBox.ts.
async function qbSetup(): Promise<Setup> {
  const c = await readConfig();
  const g = (k: string) => c.get(k) ?? "";
  let unreadable = false;
  const open = (k: string) => {
    try {
      return unseal(g(k));
    } catch {
      unreadable = true;
      return "";
    }
  };
  if (g("qbClientId") && g("qbRealRefreshToken") && g("qbRealmId")) {
    return {
      real: true,
      base: REAL_BASE,
      clientId: g("qbClientId"),
      clientSecret: g("qbClientSecret"),
      realmId: open("qbRealmId"),
      refreshToken: open("qbRealRefreshToken"),
      refreshKey: "qbRealRefreshToken",
      unreadable,
    };
  }
  return {
    real: false,
    base: SANDBOX_BASE,
    clientId: g("devClientId"),
    clientSecret: g("devClientSecret"),
    realmId: open("sandboxRealmId"),
    refreshToken: open("qbRefreshToken"),
    refreshKey: "qbRefreshToken",
    unreadable,
  };
}

// True while billing runs against the fake test company. Which company is
// connected only changes when Robert connects one, so it's looked up at most
// once a minute — not on every QuickBooks call (each look is a Sheets read, and
// Sheets allows 60 a minute; one invoice makes several QuickBooks calls).
let companyCache: { real: boolean; at: number } | null = null;
export async function isSandbox(): Promise<boolean> {
  if (!companyCache || Date.now() - companyCache.at > 60_000) companyCache = { real: (await qbSetup()).real, at: Date.now() };
  return !companyCache.real;
}

// The keys for the Connect sign-in: production keys for the real company (empty
// if Robert hasn't added them), development keys for the test company.
export async function connectKeys(test = false): Promise<{ clientId: string; clientSecret: string }> {
  const c = await readConfig();
  return test
    ? { clientId: c.get("devClientId") ?? "", clientSecret: c.get("devClientSecret") ?? "" }
    : { clientId: c.get("qbClientId") ?? "", clientSecret: c.get("qbClientSecret") ?? "" };
}

// For Settings: is the real company connected, are the production keys in
// Config, and does QuickBooks need signing in again?
export async function qbStatus(): Promise<{ real: boolean; haveKeys: boolean; reconnect: "" | "real" | "test" }> {
  const [sandbox, k, c] = await Promise.all([isSandbox(), connectKeys(), readConfig()]);
  const r = c.get(NEEDS_RECONNECT);
  return { real: !sandbox, haveKeys: !!(k.clientId && k.clientSecret), reconnect: r === "real" || r === "test" ? r : "" };
}

// Connect, step 2: swap Intuit's one-time code for the long-lived sign-in and
// save it (and the company id) to Config. Real company: from then on billing
// uses it. Test company (`test`): replaces the test company's sign-in — used to
// test connecting, disconnecting and reconnecting without touching real books.
export async function finishConnect(code: string, realmId: string, redirectUri: string, test = false): Promise<void> {
  const k = await connectKeys(test);
  if (!k.clientId || !k.clientSecret) throw new Error(`QuickBooks ${test ? "development" : "production"} keys are missing from Config`);
  const res = await fetch((await endpoints(!test)).token, {
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
  await writeConfig(test ? "sandboxRealmId" : "qbRealmId", seal(realmId));
  await writeConfig(test ? "qbRefreshToken" : "qbRealRefreshToken", seal(tok.refresh_token));
  await writeConfig(NEEDS_RECONNECT, "");
  accessCache = null; // the next call signs in with the new connection
  companyCache = null;
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
  if (cfg.unreadable) {
    // Saved with a different key (or altered): the only way back is a fresh sign-in.
    await writeConfig(NEEDS_RECONNECT, cfg.real ? "real" : "test").catch(() => {});
    throw new Error("QuickBooks needs you to sign in again — open Settings → QuickBooks → Reconnect");
  }
  if (!cfg.clientId || !cfg.refreshToken) throw new Error("QuickBooks keys are missing from Config");
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch((await endpoints(cfg.real)).token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken }),
  });
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !tok.access_token) {
    if (!retried && tok.error === "invalid_grant") {
      await new Promise((r) => setTimeout(r, 1500)); // give the other copy time to save the new token
      return refreshAccess(true);
    }
    await logQbError(cfg.real, "sign in (refresh token)", tok.error ?? `HTTP ${res.status}`, res.headers.get("intuit_tid") ?? "");
    // Still refused after a fresh look: the sign-in has expired or was
    // disconnected from the QuickBooks side. Settings now asks to reconnect.
    if (tok.error === "invalid_grant") {
      await writeConfig(NEEDS_RECONNECT, cfg.real ? "real" : "test").catch(() => {});
      throw new Error("QuickBooks needs you to sign in again — open Settings → QuickBooks → Reconnect");
    }
    throw new Error(`QuickBooks sign-in failed (${res.status}): ${tok.error ?? "unknown"}`);
  }
  if (tok.refresh_token && tok.refresh_token !== cfg.refreshToken) {
    await writeConfig(cfg.refreshKey, seal(tok.refresh_token));
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
// A 401 means QuickBooks didn't accept the access token (it expired early or
// was revoked) and did nothing — so sign in again and try once more.
async function qb<T>(path: string, init?: { method?: string; body?: unknown }, retried = false): Promise<T> {
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
  if (res.status === 401 && !retried) {
    accessCache = null;
    return qb<T>(path, init, true);
  }
  const json = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const fault = (json as { Fault?: { Error?: { Message?: string; Detail?: string }[] } }).Fault;
    const msg = fault?.Error?.[0]?.Detail ?? fault?.Error?.[0]?.Message ?? `HTTP ${res.status}`;
    const tid = res.headers.get("intuit_tid") ?? "";
    await logQbError(base === REAL_BASE, `${init?.method ?? "GET"} ${path.split("?")[0]}`, msg, tid);
    throw new Error(`QuickBooks: ${msg}${tid ? ` (Intuit tracking # ${tid})` : ""}`);
  }
  return json as T;
}

// Every QuickBooks error is kept in the dashboard's "QB log" tab — when, which
// company, what the app was doing, what QuickBooks said, and Intuit's tracking
// number (intuit_tid), which Intuit support asks for. (The server's own log only
// lasts about an hour.) A failure to log never hides the original error.
async function logQbError(real: boolean, doing: string, said: string, tid: string): Promise<void> {
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  console.error(`[quickbooks] ${doing}: ${said}${tid ? ` intuit_tid=${tid}` : ""}`);
  await appendRow("QB log!A:E", [when, real ? "real" : "test", doing.slice(0, 200), said.slice(0, 500), tid]).catch(() => {});
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

// The next invoice number. Robert's company numbers invoices itself ("custom
// transaction numbers" is on), so an invoice sent without a number gets NONE —
// QuickBooks showed it as "Invoice #NA" (2026-10-14). So: one more than the
// highest plain-number invoice among the most recent ones (1301 → 1302).
// If the lookup fails, the invoice still goes out (just without a number), and
// QuickBooks errors are written to the QB log tab by qb().
async function nextDocNumber(): Promise<string | undefined> {
  try {
    const recent = await query<Invoice>("SELECT * FROM Invoice ORDERBY MetaData.CreateTime DESC MAXRESULTS 100", "Invoice");
    const nums = recent.map((i) => i.DocNumber ?? "").filter((d) => /^\d{1,15}$/.test(d)).map(Number);
    return nums.length ? String(Math.max(...nums) + 1) : undefined; // none yet → let QuickBooks decide
  } catch (err) {
    console.error("[quickbooks] next invoice number:", err instanceof Error ? err.message : err); // qb() already wrote it to the QB log tab
    return undefined;
  }
}

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
  const docNumber = await nextDocNumber();
  if (docNumber) body.DocNumber = docNumber;
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
