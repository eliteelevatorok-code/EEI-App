/* Cloudflare Worker - the only server this app has.
   Deployed by hand through the Cloudflare dashboard (see worker/SETUP.md),
   not part of the GitHub Pages site. Two jobs:
     1. Hold two small blobs of JSON (the report database and the elevator
        roster) so the phone and the computer read/write the same copy.
     2. Be the gatekeeper. Robert sets his own unlock code from the app; it
        is never hardcoded and never stored in plain text - KV holds only a
        salted hash of it. Setting, changing, or logging in with it always
        also requires a one-time code emailed to Robert's own address, so
        only whoever controls that inbox can get in or make changes.

   Needs one secret on this Worker (Settings -> Variables, Encrypt on):
     RESEND_KEY - API key from resend.com, used to send the one-time codes
                  to Robert's email.
   (The old EEI_PIN secret is no longer used - the code now lives as a
   salted hash in KV that Robert controls.) */

const NOTIFY_EMAIL = "elite.elevator.ok@gmail.com";
const TOKEN_TTL = 60 * 60 * 24 * 90;   // 90 days - how long a device stays trusted
const OTP_TTL = 600;                    // 10 minutes to enter the emailed code
const RL_WINDOW = 900;                  // 15 minute lockout window
const RL_MAX = 5;                       // wrong codes allowed in that window

function withCORS(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type,X-EEI-TOKEN");
  return resp;
}
function json(obj, status) {
  return withCORS(new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  }));
}
function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function randomOtp() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
}

async function checkRateLimit(env, ip) {
  const key = "rl:" + ip;
  const raw = await env.EEI_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RL_MAX) return false;
  await env.EEI_KV.put(key, String(count + 1), { expirationTtl: RL_WINDOW });
  return true;
}
async function clearRateLimit(env, ip) {
  await env.EEI_KV.delete("rl:" + ip);
}

async function validToken(env, token) {
  if (!token) return false;
  return !!(await env.EEI_KV.get("tok:" + token));
}

/* ---------- the unlock codes ----------
   Each person picks their OWN code. There can be several at once (Robert,
   Stephen, mom...), and every one of them is confirmed the same way: a
   one-time code emailed to Robert's inbox. So each person has a code, but
   Robert's email is still the single gate that lets any new code in or out.

   Codes are never hardcoded and never stored in plain text. KV holds one
   "codes" blob: a list where each entry is { id, salt, hash } - a salted
   SHA-256 hash, not the code itself. */
async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
// Read the list. Falls back to the older single-code keys so an account that
// was set up before this change keeps working and its code becomes entry #1.
async function getCodes(env) {
  const raw = await env.EEI_KV.get("codes");
  if (raw) { try { const a = JSON.parse(raw); if (Array.isArray(a)) return a; } catch (e) {} }
  const salt = await env.EEI_KV.get("pin_salt");
  const hash = await env.EEI_KV.get("pin_hash");
  if (salt && hash) return [{ id: "legacy", salt, hash }];
  return [];
}
async function saveCodes(env, arr) { await env.EEI_KV.put("codes", JSON.stringify(arr)); }
async function codeIsSet(env) { return (await getCodes(env)).length > 0; }
function validNewCode(c) { return typeof c === "string" && /^\d{4,8}$/.test(c); }
async function entryMatches(entry, code) {
  return (await sha256hex(entry.salt + ":" + code)) === entry.hash;
}
// does the typed code match ANY person's code?
async function codeMatches(env, code) {
  for (const e of await getCodes(env)) { if (await entryMatches(e, code)) return true; }
  return false;
}
// add a new person's code. Refuses a code already in use so two people can't
// collide on the same digits. Returns false if it's a duplicate.
async function addCode(env, newCode) {
  const arr = await getCodes(env);
  for (const e of arr) { if (await entryMatches(e, newCode)) return false; }
  const salt = randomToken();
  const hash = await sha256hex(salt + ":" + newCode);
  arr.push({ id: randomToken().slice(0, 12), salt, hash });
  await saveCodes(env, arr);
  return true;
}
// change one person's own code, leaving everyone else's alone. Needs the
// person's current code so we know which entry to replace.
// Returns "nocur" (current code wrong), "dup" (new code taken), or "ok".
async function changeCode(env, curCode, newCode) {
  const arr = await getCodes(env);
  let idx = -1;
  for (let i = 0; i < arr.length; i++) { if (await entryMatches(arr[i], curCode)) { idx = i; break; } }
  if (idx < 0) return "nocur";
  for (let i = 0; i < arr.length; i++) { if (i !== idx && await entryMatches(arr[i], newCode)) return "dup"; }
  const salt = randomToken();
  arr[idx] = { id: arr[idx].id || randomToken().slice(0, 12), salt, hash: await sha256hex(salt + ":" + newCode) };
  await saveCodes(env, arr);
  return "ok";
}

// issue + email a one-time code tied to a fresh challenge id
async function startEmailChallenge(env) {
  const challenge = randomToken();
  const otp = randomOtp();
  await env.EEI_KV.put("chal:" + challenge, otp, { expirationTtl: OTP_TTL });
  const sent = await sendOtpEmail(env, otp);
  return { sent, challenge };
}
async function checkEmailChallenge(env, challenge, code) {
  const stored = await env.EEI_KV.get("chal:" + challenge);
  if (!stored || stored !== code) return false;
  await env.EEI_KV.delete("chal:" + challenge);
  return true;
}
async function issueToken(env) {
  const token = randomToken();
  await env.EEI_KV.put("tok:" + token, "1", { expirationTtl: TOKEN_TTL });
  return token;
}

/* ---------- the two walls, both enforced here on the server ----------
   Nothing running in a browser (mine, a test, or an attacker's) can talk
   past these, because they live in the Worker, not in the app. */

const KEEP_BACKUPS = 8;        // how many past versions to retain per slot
const BACKUP_TTL = 60*60*24*60; // 60 days
const SHRINK_FLOOR = 20;        // only guard once the slot holds a real amount
const SHRINK_RATIO = 0.5;       // reject a write that drops below half of what's stored

// count records regardless of shape: db is {data:{okla:...}}, roster is {data:[...]}
function recordCount(text) {
  if (!text || text === "null") return 0;
  try {
    const p = JSON.parse(text);
    const d = (p && typeof p === "object" && "data" in p) ? p.data : p;
    if (Array.isArray(d)) return d.length;
    if (d && typeof d === "object") return Object.keys(d).length;
    return 0;
  } catch (e) { return -1; } // unparseable incoming -> treat as suspect
}

// WALL 2: refuse a write that guts the slot (e.g. 434 records -> 1)
function wouldGut(oldText, newText) {
  const oldN = recordCount(oldText);
  const newN = recordCount(newText);
  if (newN < 0) return true;                     // incoming isn't valid JSON with data
  if (oldN < SHRINK_FLOOR) return false;         // slot wasn't holding much yet - allow
  return newN < oldN * SHRINK_RATIO;             // dropping below half of what's there
}

// WALL 1: copy the current value into a timestamped backup before overwriting,
// and prune to the newest KEEP_BACKUPS so backups can't pile up unbounded.
async function backupThenPrune(env, key, currentText) {
  if (!currentText || currentText === "null") return;
  const stamp = Date.now();
  await env.EEI_KV.put(`bak:${key}:${stamp}`, currentText, { expirationTtl: BACKUP_TTL });
  const list = await env.EEI_KV.list({ prefix: `bak:${key}:` });
  const names = list.keys.map(k => k.name).sort(); // names sort chronologically by stamp
  const extra = names.length - KEEP_BACKUPS;
  for (let i = 0; i < extra; i++) await env.EEI_KV.delete(names[i]);
}

async function sendOtpEmail(env, code) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "EEI Reports <onboarding@resend.dev>",
      to: [NOTIFY_EMAIL],
      subject: "Your EEI Reports sign-in code",
      text: `Sign-in code for a device trying to open EEI Reports: ${code}\n\nThis expires in 10 minutes. If this wasn't you, ignore it - the 4-digit code alone can't get anyone in without this.`
    })
  });
  return resp.ok;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCORS(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    // has a code been set on this account yet? (drives first-run setup vs login)
    if (url.pathname === "/has-code" && request.method === "GET") {
      return json({ ok: true, set: await codeIsSet(env) });
    }

    /* ---------- SET UP A CODE (first person, or any new person) ----------
       Each person picks their own code here. Whether it's the very first
       code or an added one, it's gated by the code emailed to Robert, so a
       stranger can never add themselves without his inbox. */
    if (url.pathname === "/setup-start" && request.method === "POST") {
      const allowed = await checkRateLimit(env, ip);
      if (!allowed) return json({ ok: false, locked: true }, 429);
      const { sent, challenge } = await startEmailChallenge(env);
      if (!sent) return json({ ok: false, emailFailed: true });
      return json({ ok: true, challenge });
    }
    if (url.pathname === "/setup-finish" && request.method === "POST") {
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      if (!validNewCode(body.newCode)) return json({ ok: false, badCode: true });
      if (!(await checkEmailChallenge(env, body.challenge, body.code))) return json({ ok: false });
      if (!(await addCode(env, body.newCode))) return json({ ok: false, dupCode: true });
      await clearRateLimit(env, ip);
      return json({ ok: true, token: await issueToken(env) });
    }

    /* ---------- LOGIN = two factors: the code, then the emailed code ----------
       A correct code alone does nothing but trigger the email. */
    if (url.pathname === "/gate-check" && request.method === "POST") {
      const allowed = await checkRateLimit(env, ip);
      if (!allowed) return json({ ok: false, locked: true }, 429);
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      if (!(await codeMatches(env, body.code))) return json({ ok: false });
      await clearRateLimit(env, ip);
      const { sent, challenge } = await startEmailChallenge(env);
      if (!sent) return json({ ok: false, emailFailed: true });
      return json({ ok: true, challenge });
    }
    if (url.pathname === "/gate-verify" && request.method === "POST") {
      const allowed = await checkRateLimit(env, ip);
      if (!allowed) return json({ ok: false, locked: true }, 429);
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      if (!(await checkEmailChallenge(env, body.challenge, body.code))) return json({ ok: false });
      await clearRateLimit(env, ip);
      return json({ ok: true, token: await issueToken(env) });
    }

    /* ---------- CHANGE YOUR OWN CODE (from Settings, while logged in) ------
       Needs a valid session, your CURRENT code (so we change the right
       person's, not someone else's), AND the emailed code - so it can't be
       changed out from under anyone by someone who grabbed an unlocked
       device. Everyone else's codes are left untouched. */
    if (url.pathname === "/change-start" && request.method === "POST") {
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      if (!(await validToken(env, body.token))) return json({ ok: false }, 401);
      const { sent, challenge } = await startEmailChallenge(env);
      if (!sent) return json({ ok: false, emailFailed: true });
      return json({ ok: true, challenge });
    }
    if (url.pathname === "/change-finish" && request.method === "POST") {
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      if (!(await validToken(env, body.token))) return json({ ok: false }, 401);
      if (!validNewCode(body.newCode)) return json({ ok: false, badCode: true });
      if (!(await codeMatches(env, body.curCode))) return json({ ok: false, badCurrent: true });
      if (!(await checkEmailChallenge(env, body.challenge, body.code))) return json({ ok: false });
      const r = await changeCode(env, body.curCode, body.newCode);
      if (r === "dup") return json({ ok: false, dupCode: true });
      if (r === "nocur") return json({ ok: false, badCurrent: true });
      return json({ ok: true });
    }

    // ---------- data sync: everything below needs a valid session token ----------
    const key = url.pathname === "/roster" ? "roster" : "db";
    const token = request.headers.get("X-EEI-TOKEN");
    if (!(await validToken(env, token))) {
      return withCORS(new Response("Not authorized", { status: 401 }));
    }

    // ---------- list the backups for a slot ----------
    if (url.pathname === "/backups" && request.method === "GET") {
      const slot = url.searchParams.get("key") === "roster" ? "roster" : "db";
      const list = await env.EEI_KV.list({ prefix: `bak:${slot}:` });
      const out = [];
      for (const k of list.keys) {
        const stamp = parseInt(k.name.split(":").pop(), 10);
        const text = await env.EEI_KV.get(k.name);
        out.push({ name: k.name, when: new Date(stamp).toISOString(), records: recordCount(text) });
      }
      out.sort((a, b) => b.name.localeCompare(a.name)); // newest first
      return json({ ok: true, backups: out });
    }

    // ---------- restore a backup into its live slot ----------
    if (url.pathname === "/restore" && request.method === "POST") {
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      const slot = body.key === "roster" ? "roster" : "db";
      // default to the newest backup if none named
      let name = body.name;
      if (!name) {
        const list = await env.EEI_KV.list({ prefix: `bak:${slot}:` });
        const names = list.keys.map(k => k.name).sort();
        name = names[names.length - 1];
      }
      if (!name) return json({ ok: false, error: "no backups" }, 404);
      const text = await env.EEI_KV.get(name);
      if (!text) return json({ ok: false, error: "backup missing" }, 404);
      const current = await env.EEI_KV.get(slot);
      await backupThenPrune(env, slot, current); // snapshot the (bad) current before restoring
      await env.EEI_KV.put(slot, text);
      return json({ ok: true, restored: name, records: recordCount(text) });
    }

    if (request.method === "GET") {
      const stored = await env.EEI_KV.get(key);
      return withCORS(new Response(stored || "null", {
        headers: { "Content-Type": "application/json" }
      }));
    }
    if (request.method === "POST") {
      const body = await request.text();
      const current = await env.EEI_KV.get(key);
      const force = request.headers.get("X-EEI-FORCE") === "1";
      if (!force && wouldGut(current, body)) {
        return json({
          ok: false,
          rejected: "shrink-guard",
          storedRecords: recordCount(current),
          incomingRecords: recordCount(body)
        }, 409);
      }
      await backupThenPrune(env, key, current);
      await env.EEI_KV.put(key, body);
      return withCORS(new Response("ok"));
    }
    return withCORS(new Response("Not found", { status: 404 }));
  }
};
