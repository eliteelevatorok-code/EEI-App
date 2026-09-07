import { GoogleAuth } from "google-auth-library";

const SHEET_ID = "1HlV3pkQc0sdwghuzlcMRgC0WAkR-pSBOLDM8xjVP4Ss";
const FOLDER_ID = "17-QkyhTDbDCkfRVU0QfYAiPjUS0cXO8w";

const auth = new GoogleAuth({
  keyFile: ".secrets/service-account.json",
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});
const client = await auth.getClient();

// 1) Read a few cells from the dashboard
const read = await client.request({
  url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Elevators!A1:D2`,
});
console.log("SHEET READ OK. First rows:");
console.log(JSON.stringify(read.data.values, null, 0));

// 2) Confirm the Drive folder is reachable
const folder = await client.request({
  url: `https://www.googleapis.com/drive/v3/files/${FOLDER_ID}?fields=id,name`,
});
console.log("DRIVE FOLDER OK:", JSON.stringify(folder.data));
