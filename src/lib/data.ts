// Sample data for the field UI. Nothing here is a real customer — these mirror
// the dashboard's test rows. Real records will load from the dashboard later.

export type LineKind = "V" | "R" | "C";

export type AddedViolation = {
  raw: string;
  kind: LineKind;
  violation: string;
  recommendation: string;
  comment: string;
};

export type Field = { label: string; value: string };

export type Elevator = {
  okla: string;
  building: string;
  account: string;
  contact: string;
  area: string;
  city: string;
  type: string;
  floors: number;
  cycle: string; // "1" | "2" | "3" | "Res"
  due: string;
  row?: number; // the dashboard sheet row this came from (for write-back)
  carried: Field[]; // fixed info: shown, but locked on the phone
  lastYear: {
    date: string;
    inspType: string;
    test1: string;
    test5: string;
    certIssue: string;
    condition: string;
    notes: string;
  };
};

export type Account = { name: string; units: Elevator[] };

export const INSPECTION_TYPES = ["Initial", "Periodic", "Reinsp", "Follow-up", "Witness", "Alteration"];
export const CYCLES = ["1", "2", "3", "Res"];
export const CERT_ISSUE = ["Yes", "No"];
export const CONDITIONS = ["No adverse conditions", "Red Tag", "Inactive", "Scrapped"];

function carried(over: Partial<Record<string, string>>): Field[] {
  const order: [string, string][] = [
    ["serial", "Serial number"],
    ["permit", "Permit #"],
    ["mfr", "Manufacturer"],
    ["capacity", "Capacity (lbs)"],
    ["speed", "Speed (FPM)"],
    ["rise", "Rise"],
    ["openings", "Openings"],
    ["landings", "# of landings"],
    ["deviceType", "Device type"],
    ["installed", "Installed year"],
    ["codeYear", "Code year"],
    ["machineType", "Machine type"],
    ["owner", "Owner"],
    ["ownerAddr", "Owner address"],
    ["locAddr", "Location address"],
  ];
  return order.map(([k, label]) => ({ label, value: over[k] ?? "" }));
}

export const ACCOUNTS: Account[] = [
  {
    name: "Lawton City (test)",
    units: [
      {
        okla: "990001",
        building: "Lawton Civic Center",
        account: "Lawton City (test)",
        contact: "Dana Cole",
        area: "Southwest OK",
        city: "Lawton",
        type: "Elevator (Traction)",
        floors: 7,
        cycle: "1",
        due: "9/30/2026",
        carried: carried({
          serial: "TX-449812",
          permit: "OK-77120",
          mfr: "Otis",
          capacity: "3000",
          speed: "200",
          rise: "72 ft 4 in",
          openings: "7",
          landings: "7",
          deviceType: "Passenger",
          installed: "1998",
          codeYear: "2016",
          machineType: "Cable",
          owner: "City of Lawton",
          ownerAddr: "212 SW 9th St, Lawton, OK 73501",
          locAddr: "801 NW Ferris Ave, Lawton, OK 73507",
        }),
        lastYear: {
          date: "9/18/2025",
          inspType: "Periodic",
          test1: "08/2025",
          test5: "08/2023",
          certIssue: "Yes",
          condition: "No adverse conditions",
          notes: "",
        },
      },
    ],
  },
  {
    name: "Commerce (test)",
    units: [
      {
        okla: "990005",
        building: "OKC Commerce Center (Car A)",
        account: "Commerce (test)",
        contact: "Robert Lassiter",
        area: "Central OK",
        city: "Oklahoma City",
        type: "Elevator (Traction)",
        floors: 5,
        cycle: "1",
        due: "9/30/2026",
        carried: carried({
          serial: "KX-201755",
          permit: "OK-64410",
          mfr: "Kone",
          capacity: "2500",
          speed: "150",
          rise: "52 ft 0 in",
          openings: "5",
          landings: "5",
          deviceType: "Passenger",
          installed: "2005",
          codeYear: "2019",
          machineType: "Cable",
          owner: "Commerce Center LLC",
          ownerAddr: "500 N Broadway Ave, Oklahoma City, OK 73102",
          locAddr: "500 N Broadway Ave, Oklahoma City, OK 73102",
        }),
        lastYear: {
          date: "9/24/2025",
          inspType: "Periodic",
          test1: "07/2025",
          test5: "07/2022",
          certIssue: "Yes",
          condition: "No adverse conditions",
          notes: "",
        },
      },
      {
        okla: "990006",
        building: "OKC Commerce Center (Car B)",
        account: "Commerce (test)",
        contact: "Robert Lassiter",
        area: "Central OK",
        city: "Oklahoma City",
        type: "Elevator (Traction)",
        floors: 5,
        cycle: "1",
        due: "9/30/2026",
        carried: carried({
          serial: "KX-201756",
          permit: "OK-64411",
          mfr: "Kone",
          capacity: "2500",
          speed: "150",
          rise: "52 ft 0 in",
          openings: "5",
          landings: "5",
          deviceType: "Passenger",
          installed: "2005",
          codeYear: "2019",
          machineType: "Cable",
          owner: "Commerce Center LLC",
          ownerAddr: "500 N Broadway Ave, Oklahoma City, OK 73102",
          locAddr: "500 N Broadway Ave, Oklahoma City, OK 73102",
        }),
        lastYear: {
          date: "9/24/2025",
          inspType: "Periodic",
          test1: "07/2025",
          test5: "07/2022",
          certIssue: "Yes",
          condition: "No adverse conditions",
          notes: "",
        },
      },
    ],
  },
  {
    name: "Guymon (test)",
    units: [
      {
        okla: "990005b",
        building: "Guymon Senior Center",
        account: "Guymon (test)",
        contact: "Pat Gomez",
        area: "Panhandle",
        city: "Guymon",
        type: "Wheelchair/Platform Lift",
        floors: 2,
        cycle: "3",
        due: "11/20/2026",
        carried: carried({
          serial: "SV-11902",
          permit: "OK-88031",
          mfr: "Savaria",
          capacity: "750",
          speed: "30",
          rise: "12 ft 0 in",
          openings: "2",
          landings: "2",
          deviceType: "Platform Lift",
          installed: "2014",
          codeYear: "2016",
          machineType: "Roped Hydraulic",
          owner: "Guymon Senior Services",
          ownerAddr: "410 N Ellison St, Guymon, OK 73942",
          locAddr: "410 N Ellison St, Guymon, OK 73942",
        }),
        lastYear: {
          date: "11/8/2023",
          inspType: "Periodic",
          test1: "10/2023",
          test5: "",
          certIssue: "Yes",
          condition: "No adverse conditions",
          notes: "",
        },
      },
    ],
  },
];
