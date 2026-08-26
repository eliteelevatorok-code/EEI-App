/* Cloudflare Worker - the only server this app has.
   Deployed by hand through the Cloudflare dashboard (see worker/SETUP.md),
   not part of the GitHub Pages site. Its only job: hold two small blobs of
   JSON (the report database and the elevator roster) so the phone and the
   computer can both read and write the same copy instead of two separate
   ones sitting in two separate browsers.

   Protection is the same 0508 code the app already uses - checked here as a
   header on every request. That is deliberately simple, not real security:
   a 4-digit code is guessable by someone determined to try. Good enough for
   keeping this private between Robert's own devices, not for anything more. */

const PIN = "0508";

function withCORS(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type,X-EEI-PIN");
  return resp;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCORS(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const key = url.pathname === "/roster" ? "roster" : "db";

    if (request.headers.get("X-EEI-PIN") !== PIN) {
      return withCORS(new Response("Wrong code", { status: 401 }));
    }

    if (request.method === "GET") {
      const stored = await env.EEI_KV.get(key);
      return withCORS(new Response(stored || "null", {
        headers: { "Content-Type": "application/json" }
      }));
    }

    if (request.method === "POST") {
      const body = await request.text();
      await env.EEI_KV.put(key, body);
      return withCORS(new Response("ok"));
    }

    return withCORS(new Response("Not found", { status: 404 }));
  }
};
