import { GoogleAuth } from "google-auth-library";

const SHEET_ID = "1HlV3pkQc0sdwghuzlcMRgC0WAkR-pSBOLDM8xjVP4Ss";
const auth = new GoogleAuth({
  keyFile: ".secrets/service-account.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const client = await auth.getClient();

// pull dataValidation for row 3 (first data row), columns A..AF
const res = await client.request({
  url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?ranges=Elevators!A3:AF3&fields=sheets.data.rowData.values(dataValidation,userEnteredValue)&includeGridData=true`,
});
const col = (n) => { let s=""; n++; while(n>0){const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };
const values = res.data.sheets[0].data[0].rowData[0].values || [];
values.forEach((v, c) => {
  const dv = v.dataValidation;
  if (dv && dv.condition && dv.condition.values) {
    const opts = dv.condition.values.map((x) => x.userEnteredValue).join(" | ");
    console.log(`${col(c)}: [${dv.condition.type}] ${opts}`);
  }
});
