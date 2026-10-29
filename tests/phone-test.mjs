// Automatic phone tests (Robert, 2026-10-29: "catch broken buttons before they
// go live"). Runs on GitHub after every push — see .github/workflows/phone-tests.yml.
// A simulated Android phone taps through the customer pages and the app's key
// screens. Every server answer is faked here, so nothing touches the real
// dashboard, emails or QuickBooks. Any failed check fails the run.
//
// Run by hand: build + start the app on port 3005 with the login wall open
// (the workflow shows how), then `node tests/phone-test.mjs`.

import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3005";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  →  ${detail}`}`);
};

// ---- fake data ----
const STAGES = [
  ["twoMoEmail", "2-month heads-up email", ["Sent"], "S"], ["quote", "Price quote email", ["Review", "Sent"], "T"],
  ["po", "Purchase order (PO)", ["Awaiting", "Received", "N/A"], "U"], ["maintConfirm", "Safety test question", ["Waiting", "Answered", "No answer"], "W"],
  ["scheduling", "Scheduling email", ["Sent"], "V"], ["visit", "Visit", ["Booked"], "Y"], ["tripDay", "Trip day", [], "Z"],
  ["accessReminder", "Access reminder", ["Sent"], "X"], ["report", "Report", [], "AA"], ["invoice", "Invoice", ["Sent"], "AB"],
  ["followUps", "Follow-ups", ["#1 sent", "#2 sent", "#3 sent"], "AC"], ["paid", "Paid", ["Paid"], "AD"], ["newTimer", "Next year set up", ["Set"], "AE"],
];
const DETAILS = ["Serial number", "Permit #", "Location address", "Location zip", "County", "Nature of business", "Entity type", "Hoistway location",
  "Device location in hoistway", "Manufacturer", "Capacity (lbs)", "Speed (FPM)", "Rise", "Openings", "# of landings", "Device type", "Installed year", "Code year"];
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; };
function elevator(o = {}, stages = {}) {
  return {
    okla: "990001", building: "Test Building", account: "Test Account", contact: "Pat", email: "pat@example.com", phone: "4055550100",
    area: "SW", city: "Lawton", type: "Elevator (Hydraulic)", floors: 3, cycle: "1", due: inDays(200), price: "$5", moneyPath: "Quote to PO to invoice",
    active: true, row: 2, safetyTest: "",
    lifecycle: STAGES.map(([key, label, options, col]) => ({ key, label, options, col, value: stages[key] ?? "", ...(key === "tripDay" ? { date: true } : {}), ...(key === "report" ? { locked: true } : {}) })),
    carried: [{ label: "Machine type", value: "Hydraulic" }, ...DETAILS.map((label) => ({ label, value: "1" }))],
    lastYear: { date: "", inspType: "Periodic", test1: "", test5: "", certIssue: "Yes", condition: "No adverse conditions", notes: "" },
    ...o,
  };
}
const READY = { twoMoEmail: "Sent", quote: "Sent", po: "Received", maintConfirm: "Answered", scheduling: "Sent", visit: "Booked", tripDay: inDays(0), accessReminder: "Sent" };

const browser = await chromium.launch();
async function phone(fake) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/api/**", (route) => fake(route, new URL(route.request().url()).pathname, route.request()));
  return { p, ctx, errors };
}
const bodyText = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const alertText = async (p) => (await p.locator("[role=alert]").allInnerTexts()).join(" ");

// ---------- customer page: Submit PO ----------
for (const mode of ["ok", "down", "502"]) {
  const posts = [];
  const { p, ctx } = await phone((route, path, req) => {
    if (path === "/api/pagelog") return route.fulfill({ status: 204 });
    if (path === "/api/po" && req.method() === "GET") return route.fulfill({ json: { building: "Test Building", okla: "990001", alreadyPO: "", invoiced: false, closed: false } });
    if (path === "/api/po") {
      posts.push(req.postData() || "");
      if (mode === "down") return route.abort("failed");
      if (mode === "502") return route.fulfill({ status: 502, json: { error: "Couldn't save just now — please try again in a minute." } });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  await p.goto(`${BASE}/po?t=tok`);
  await p.waitForSelector("button[type=submit]");
  if (mode === "ok") {
    await p.tap("button[type=submit]");
    await p.waitForTimeout(300);
    check("PO: empty Submit says what's missing", /enter your PO/i.test(await alertText(p)), await alertText(p));
    // A phone keyboard that never passed the typing on to the page.
    await p.$eval("input:not([type=file])", (el) => { el.value = "TEST1"; });
  } else {
    await p.tap("input:not([type=file])");
    await p.keyboard.type("TEST1");
  }
  await p.tap("button[type=submit]");
  await p.waitForTimeout(1200);
  const heading = await p.$eval("h1", (h) => h.innerText).catch(() => "");
  if (mode === "ok") check("PO: Submit sends the number and says thanks", posts.some((b) => b.includes("TEST1")) && /Got it/.test(heading), `heading="${heading}" posts=${posts.length}`);
  if (mode === "down") check("PO: no signal → plain message, not a dead button", /reach the app/i.test(await alertText(p)), await alertText(p));
  if (mode === "502") check("PO: server error → server's message shown", /try again in a minute/i.test(await alertText(p)), await alertText(p));
  await ctx.close();
}

// ---------- customer page: safety-test answers ----------
{
  const posts = [];
  const { p, ctx } = await phone((route, path, req) => {
    if (path === "/api/pagelog") return route.fulfill({ status: 204 });
    if (path === "/api/maint" && req.method() === "GET") return route.fulfill({ json: { building: "Test Building", okla: "990001", maintCo: "", alreadyResult: "", alreadyDate: "", closed: false } });
    if (path === "/api/maint") { posts.push(req.postData() || ""); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: {} });
  });
  await p.goto(`${BASE}/maint?t=tok`);
  await p.waitForSelector("button[type=submit]");
  await p.tap("button[type=submit]");
  await p.waitForTimeout(300);
  check("Safety form: empty send asks for Yes/No", /Yes or No/i.test(await alertText(p)), await alertText(p));
  await p.tap("button:has-text('Yes')");
  await p.fill("input[type=date]", "2099-01-01");
  await p.tap("button[type=submit]");
  await p.waitForTimeout(300);
  check("Safety form: future date refused before sending", /future/i.test(await alertText(p)) && posts.length === 0, `${await alertText(p)} posts=${posts.length}`);
  const d = new Date(); d.setDate(d.getDate() - 30);
  await p.fill("input[type=date]", d.toISOString().slice(0, 10));
  await p.tap("button[type=submit]");
  await p.waitForTimeout(1000);
  check("Safety form: good answer is sent", posts.length === 1 && posts[0].includes('"Yes"'), `posts=${JSON.stringify(posts)}`);
  await ctx.close();
}

// ---------- app: list fails to load, then Try again ----------
{
  let fail = true;
  const { p, ctx } = await phone((route, path) => {
    if (path === "/api/roster") return fail ? route.fulfill({ status: 502, json: { error: "Google was busy" } }) : route.fulfill({ json: { accounts: [{ name: "Test Account", units: [elevator()] }] } });
    return route.fulfill({ json: {} });
  });
  await p.goto(`${BASE}/?tab=elevators`);
  await p.waitForSelector("button:has-text('Try again')", { timeout: 15000 }).catch(() => {});
  check("App: failed list load shows Try again", (await p.locator("button:has-text('Try again')").count()) > 0, await bodyText(p));
  fail = false;
  await p.tap("button:has-text('Try again')").catch(() => {});
  await p.waitForTimeout(2000);
  check("App: Try again loads the list", (await bodyText(p)).includes("Test Building"), (await bodyText(p)).slice(0, 200));
  await ctx.close();
}

// ---------- app: report screen rules ----------
{
  let sent = null;
  const { p, ctx, errors } = await phone((route, path, req) => {
    if (path === "/api/roster") return route.fulfill({ json: { accounts: [{ name: "Test Account", units: [elevator({}, READY)] }] } });
    if (path === "/api/finalize") { sent = JSON.parse(req.postData() || "{}"); return route.fulfill({ status: 400, json: { error: "stopped by test" } }); }
    return route.fulfill({ json: {} });
  });
  await p.goto(`${BASE}/?report=990001`);
  await p.waitForSelector("#req-test1 input", { timeout: 15000 });
  const t1 = p.locator("#req-test1 input");
  await t1.fill("");
  await t1.pressSequentially("10202265555");
  check("Report: one-year test stops at MM/YYYY", (await t1.inputValue()) === "10/2022", await t1.inputValue());
  const on = async (id) => (await p.locator(`#${id} .chip-on`).allInnerTexts()).join(",");
  for (const c of ["Red Tag", "Scrapped", "Inactive"]) {
    await p.locator("#req-certIssue button:has-text('Yes')").tap();
    await p.locator(`#req-condition button:has-text("${c}")`).tap();
    check(`Report: ${c} sets certificate to No`, (await on("req-certIssue")) === "No", await on("req-certIssue"));
    await p.locator("#req-certIssue button:has-text('Yes')").tap();
    check(`Report: certificate Yes clears ${c}`, (await on("req-condition")) === "", await on("req-condition"));
  }
  await p.locator("#req-condition button:has-text('Red Tag')").tap();
  await t1.fill("");
  await t1.pressSequentially("092026");
  await p.locator("textarea.input").first().fill("Gate code 4321");
  await p.locator("#req-date input").fill("2026-10-28");
  await p.locator("button:has-text('Finish')").first().tap();
  await p.waitForTimeout(1500);
  const r = sent?.report ?? {};
  check("Report: Finish sends Red Tag with no certificate and the notes", r.condition === "Red Tag" && r.certIssue === "No" && r.notes === "Gate code 4321", JSON.stringify(r).slice(0, 200));
  check("Report: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------- app: things that need you ----------
{
  const units = [
    elevator({ okla: "1", building: "No Email Soon", email: "", due: inDays(20) }),
    elevator({ okla: "2", building: "No Due Never Inspected", due: "", lastReport: "" }),
    elevator({ okla: "3", building: "No Due After Red Tag", due: "", lastReport: "https://drive.google.com/x" }),
    elevator({ okla: "4", building: "Invoice Only No Price", due: inDays(20), price: "", moneyPath: "Invoice only" }),
    elevator({ okla: "5", building: "With Notes", notes: "10/28/2026: Gate code 4321" }),
  ];
  const { p, ctx } = await phone((route, path) =>
    path === "/api/roster" ? route.fulfill({ json: { accounts: [{ name: "Test Account", units }] } }) : route.fulfill({ json: {} }),
  );
  await p.goto(`${BASE}/?tab=today`);
  await p.waitForTimeout(2500);
  const t = await bodyText(p);
  check("Today: missing customer email flagged", /No Email Soon No customer email/.test(t), t.slice(0, 300));
  check("Today: missing due date flagged", /No Due Never Inspected No due date/.test(t), t.slice(0, 300));
  check("Today: red-tagged elevator not flagged for due date", !t.includes("No Due After Red Tag"), t.slice(0, 300));
  check("Today: invoice-only says the bill can't go out", /Invoice Only No Price Price missing — the bill/.test(t), t.slice(0, 300));
  await p.goto(`${BASE}/?open=5`);
  await p.waitForTimeout(2000);
  check("Profile: report notes are shown", (await bodyText(p)).includes("Gate code 4321"), (await bodyText(p)).slice(0, 200));
  await ctx.close();
}

// ---------- app: Money tab shows a bill carried over unpaid ----------
{
  const { p, ctx } = await phone((route, path) => {
    if (path === "/api/roster") return route.fulfill({ json: { accounts: [{ name: "Test Account", units: [elevator()] }] } });
    if (path === "/api/payments") return route.fulfill({ json: { payments: [], unpaid: [{ billedOn: "10/1/2026", okla: "990001", building: "Test Building", amount: 250, invoice: "77" }] } });
    return route.fulfill({ json: {} });
  });
  await p.goto(`${BASE}/?tab=money`);
  await p.waitForTimeout(2500);
  const t = await bodyText(p);
  check("Money: unpaid bill from last time is listed and counted", /Unpaid from last time/.test(t) && /Waiting on \$250/.test(t), t.slice(0, 300));
  await ctx.close();
}

await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
