import { OAuth2Client } from "google-auth-library";
import http from "node:http";
import fs from "node:fs";

const conf = JSON.parse(fs.readFileSync(".secrets/oauth-client.json", "utf8"));
const c = conf.web || conf.installed;
const REDIRECT = "http://localhost:5555/callback";
const oauth = new OAuth2Client(c.client_id, c.client_secret, REDIRECT);

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/callback")) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code");
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    fs.writeFileSync(".secrets/oauth-token.json", JSON.stringify(tokens, null, 2));
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Elite Elevator: sign-in complete.</h2><p>You can close this tab.</p>",
    );
    console.log("TOKEN SAVED. refresh_token present:", Boolean(tokens.refresh_token));
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500).end("Token exchange failed");
    console.error("EXCHANGE FAILED:", e?.message);
    setTimeout(() => process.exit(1), 500);
  }
});
server.listen(5555, () => {
  console.log("AUTH_URL:", url);
});
