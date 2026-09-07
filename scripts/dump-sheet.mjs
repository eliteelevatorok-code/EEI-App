import { GoogleAuth } from "google-auth-library";

const SHEET_ID = "1HlV3pkQc0sdwghuzlcMRgC0WAkR-pSBOLDM8xjVP4Ss";
const auth = new GoogleAuth({
  keyFile: ".secrets/service-account.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const client = await auth.getClient();

// tab names
const meta = await client.request({
  url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(title,gridProperties)`,
});
console.log("TABS:", meta.data.sheets.map((s) => `${s.properties.title} (${s.properties.gridProperties.rowCount}x${s.properties.gridProperties.columnCount})`).join(" | "));

const col = (n) => {
  let s = "";
  n++;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const read = await client.request({
  url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Elevators!A1:BЗ6`.replace("З", "Z"),
});
const rows = read.data.values || [];
for (let r = 0; r < Math.min(rows.length, 6); r++) {
  console.log(`\n--- row ${r + 1} ---`);
  rows[r].forEach((v, c) => { if (v !== "") console.log(`  ${col(c)}: ${v}`); });
}
