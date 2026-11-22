import cityTimezones from "city-timezones";

export interface CityRec {
  city: string;
  country: string;
  province: string;
  iso2: string;
  timezone: string;
  pop: number;
}

interface RawCity {
  city: string;
  city_ascii?: string;
  country: string;
  province?: string;
  iso2?: string;
  timezone: string;
  pop?: number;
}

const RAW: RawCity[] = (cityTimezones as { cityMapping: RawCity[] }).cityMapping;

// Keep only rows with a usable timezone; precompute a lowercase search key.
const S = (v: unknown): string => (v == null ? "" : String(v));

const INDEX: (CityRec & { key: string })[] = RAW.filter((r) => r.timezone).map(
  (r) => ({
    city: S(r.city),
    country: S(r.country),
    province: S(r.province),
    iso2: S(r.iso2).toUpperCase(),
    timezone: S(r.timezone),
    pop: typeof r.pop === "number" ? r.pop : 0,
    key: `${S(r.city)} ${S(r.city_ascii)} ${S(r.country)} ${S(r.province)}`.toLowerCase(),
  })
);

/** A synthetic reference entry for UTC (not a real city). */
export const UTC_ENTRY: CityRec = {
  city: "UTC",
  country: "Coordinated Universal Time",
  province: "",
  iso2: "",
  timezone: "UTC",
  pop: Number.MAX_SAFE_INTEGER,
};

export const DEFAULT_CITIES: CityRec[] = [
  rec("Chennai", "Asia/Kolkata") ?? fallback("Chennai", "India", "Asia/Kolkata", "IN"),
  UTC_ENTRY,
  rec("San Francisco", "America/Los_Angeles") ??
    fallback("San Francisco", "United States", "America/Los_Angeles", "US"),
];

function rec(city: string, tz: string): CityRec | undefined {
  const r = INDEX.find((x) => x.city === city && x.timezone === tz);
  return r ? strip(r) : undefined;
}
function fallback(city: string, country: string, tz: string, iso2: string): CityRec {
  return { city, country, province: "", iso2, timezone: tz, pop: 0 };
}
function strip(r: CityRec & { key: string }): CityRec {
  const { key, ...rest } = r;
  return rest;
}

/** Stable id for a chosen place. */
export function cityId(c: CityRec): string {
  return `${c.city}|${c.timezone}`;
}

/** Search worldwide cities; biggest/most-relevant first. */
export function searchCities(query: string, limit = 6): CityRec[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts: typeof INDEX = [];
  const contains: typeof INDEX = [];
  for (const r of INDEX) {
    if (r.city.toLowerCase().startsWith(q)) starts.push(r);
    else if (r.key.includes(q)) contains.push(r);
    if (starts.length > 60) break;
  }
  const rank = (a: CityRec, b: CityRec) => b.pop - a.pop;
  const seen = new Set<string>();
  const out: CityRec[] = [];
  for (const r of [...starts.sort(rank), ...contains.sort(rank)]) {
    const id = cityId(r);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(strip(r));
    if (out.length >= limit) break;
  }
  return out;
}

/** ISO2 country code → flag emoji (globe for UTC / unknown). */
export function flag(iso2: string): string {
  const s = String(iso2 ?? "");
  if (s.length !== 2 || !/^[A-Za-z]{2}$/.test(s)) return "🌐";
  return String.fromCodePoint(
    ...[...s.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))
  );
}

/** "GMT+5:30" style offset label for a timezone at a given instant. */
export function offsetLabel(tz: string, when: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(when);
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    return name === "GMT" ? "GMT+0" : name;
  } catch {
    return "";
  }
}

/** Numeric UTC offset in minutes, for sorting. */
export function offsetMinutes(tz: string, when: number): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    })
      .formatToParts(when)
      .find((p) => p.type === "timeZoneName")?.value;
    const m = s?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2]) * 60 + (m[3] ? parseInt(m[3]) : 0));
  } catch {
    return 0;
  }
}
