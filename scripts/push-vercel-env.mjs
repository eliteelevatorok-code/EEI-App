import fs from "node:fs";

const VT = fs.readFileSync(".secrets/vercel-token.txt", "utf8").trim();
const TEAM = "team_jvnPdLLClL7UtuhJSkhF1Mq3";
const PROJECT = "eei-app";

const sa = JSON.stringify(JSON.parse(fs.readFileSync(".secrets/service-account.json", "utf8")));
const oc = JSON.parse(fs.readFileSync(".secrets/oauth-client.json", "utf8"));
const c = oc.web || oc.installed;
const tok = JSON.parse(fs.readFileSync(".secrets/oauth-token.json", "utf8"));

const vars = [
  ["GOOGLE_SERVICE_ACCOUNT_JSON", sa],
  ["GOOGLE_OAUTH_CLIENT_ID", c.client_id],
  ["GOOGLE_OAUTH_CLIENT_SECRET", c.client_secret],
  ["GOOGLE_OAUTH_REFRESH_TOKEN", tok.refresh_token],
];

for (const [key, value] of vars) {
  const body = JSON.stringify({ key, value, type: "encrypted", target: ["production", "preview", "development"] });
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${PROJECT}/env?teamId=${TEAM}&upsert=true`,
    { method: "POST", headers: { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" }, body },
  );
  // Print only the key + status, never the value.
  console.log(key, "->", res.status, res.ok ? "OK" : (await res.text()).slice(0, 160));
}
