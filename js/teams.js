// Canonical AFL team names (as used by the Squiggle API), short labels and club colours.
export const TEAMS = [
  { name: "Adelaide",               short: "Adelaide",      abbr: "ADE", c1: "#002b5c", c2: "#e21937" },
  { name: "Brisbane Lions",         short: "Brisbane",      abbr: "BRL", c1: "#a30046", c2: "#fdbe57" },
  { name: "Carlton",                short: "Carlton",       abbr: "CAR", c1: "#0e1e2d", c2: "#ffffff" },
  { name: "Collingwood",            short: "Collingwood",   abbr: "COL", c1: "#000000", c2: "#ffffff" },
  { name: "Essendon",               short: "Essendon",      abbr: "ESS", c1: "#cc2031", c2: "#000000" },
  { name: "Fremantle",              short: "Fremantle",     abbr: "FRE", c1: "#2a0d54", c2: "#ffffff" },
  { name: "Geelong",                short: "Geelong",       abbr: "GEE", c1: "#1c3c63", c2: "#ffffff" },
  { name: "Gold Coast",             short: "Gold Coast",    abbr: "GCS", c1: "#d93e39", c2: "#f6bd00" },
  { name: "Greater Western Sydney", short: "GWS",           abbr: "GWS", c1: "#f15c22", c2: "#4a4f55" },
  { name: "Hawthorn",               short: "Hawthorn",      abbr: "HAW", c1: "#4d2004", c2: "#fbbf15" },
  { name: "Melbourne",              short: "Melbourne",     abbr: "MEL", c1: "#0f1131", c2: "#cc2031" },
  { name: "North Melbourne",        short: "North Melb",    abbr: "NTH", c1: "#013b9f", c2: "#ffffff" },
  { name: "Port Adelaide",          short: "Port Adelaide", abbr: "PTA", c1: "#008aab", c2: "#000000" },
  { name: "Richmond",               short: "Richmond",      abbr: "RIC", c1: "#000000", c2: "#fed102" },
  { name: "St Kilda",               short: "St Kilda",      abbr: "STK", c1: "#ed0f05", c2: "#000000" },
  { name: "Sydney",                 short: "Sydney",        abbr: "SYD", c1: "#ed171f", c2: "#ffffff" },
  { name: "West Coast",             short: "West Coast",    abbr: "WCE", c1: "#062ee2", c2: "#ffd700" },
  { name: "Western Bulldogs",       short: "Bulldogs",      abbr: "WBD", c1: "#014896", c2: "#e21937" },
];

export const TEAM_NAMES = TEAMS.map(t => t.name);
const BY_NAME = Object.fromEntries(TEAMS.map(t => [t.name, t]));

// Loose aliases so spreadsheets / other sources map onto canonical names.
const ALIASES = {
  "adelaide crows": "Adelaide", "crows": "Adelaide",
  "brisbane": "Brisbane Lions", "lions": "Brisbane Lions", "brisbane bears": "Brisbane Lions",
  "blues": "Carlton",
  "magpies": "Collingwood", "pies": "Collingwood",
  "bombers": "Essendon",
  "dockers": "Fremantle", "freo": "Fremantle",
  "geelong cats": "Geelong", "cats": "Geelong",
  "gold coast suns": "Gold Coast", "suns": "Gold Coast",
  "gws": "Greater Western Sydney", "gws giants": "Greater Western Sydney", "giants": "Greater Western Sydney",
  "hawks": "Hawthorn",
  "demons": "Melbourne", "dees": "Melbourne",
  "north": "North Melbourne", "kangaroos": "North Melbourne", "roos": "North Melbourne", "north melb": "North Melbourne",
  "port": "Port Adelaide", "power": "Port Adelaide", "port adelaide power": "Port Adelaide",
  "tigers": "Richmond",
  "saints": "St Kilda", "st. kilda": "St Kilda",
  "sydney swans": "Sydney", "swans": "Sydney",
  "west coast eagles": "West Coast", "eagles": "West Coast",
  "bulldogs": "Western Bulldogs", "dogs": "Western Bulldogs", "footscray": "Western Bulldogs",
};

export function canonical(name) {
  if (!name) return null;
  const s = String(name).trim();
  if (BY_NAME[s]) return s;
  const lower = s.toLowerCase();
  const exact = TEAMS.find(t => t.name.toLowerCase() === lower || t.short.toLowerCase() === lower || t.abbr.toLowerCase() === lower);
  if (exact) return exact.name;
  return ALIASES[lower] || null;
}

export function team(name) {
  return BY_NAME[canonical(name)] || { name, short: name, abbr: "?", c1: "#888", c2: "#ccc" };
}
