import { useEffect, useMemo, useState } from "react";
import { UNLOCK_CODE } from "../supabase";

// A real, useful world clock. The "Add city" box doubles as the secret door:
// type the unlock code there and press + to open the real app.

type Zone = { city: string; tz: string };

const PRESETS: Zone[] = [
  { city: "Chennai (IST)", tz: "Asia/Kolkata" },
  { city: "UTC", tz: "UTC" },
  { city: "San Francisco (PST)", tz: "America/Los_Angeles" },
  { city: "New York (EST)", tz: "America/New_York" },
  { city: "London", tz: "Europe/London" },
  { city: "Singapore", tz: "Asia/Singapore" },
  { city: "Dubai", tz: "Asia/Dubai" },
  { city: "Sydney", tz: "Australia/Sydney" },
  { city: "Berlin", tz: "Europe/Berlin" },
  { city: "Tokyo", tz: "Asia/Tokyo" },
];

const DEFAULTS = ["Asia/Kolkata", "UTC", "America/Los_Angeles"];
const LS = "tz_cities";

function loadCities(): Zone[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return PRESETS.filter((z) => DEFAULTS.includes(z.tz));
}

export function WorldClock({ onUnlock }: { onUnlock: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [cities, setCities] = useState<Zone[]>(loadCities);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    localStorage.setItem(LS, JSON.stringify(cities));
  }, [cities]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return PRESETS.filter(
      (z) =>
        z.city.toLowerCase().includes(q) &&
        !cities.some((c) => c.tz === z.tz)
    ).slice(0, 5);
  }, [query, cities]);

  function handleAdd() {
    const q = query.trim();
    // --- secret door ---
    if (q === UNLOCK_CODE) {
      setQuery("");
      onUnlock();
      return;
    }
    const match =
      suggestions[0] ||
      PRESETS.find((z) => z.city.toLowerCase().includes(q.toLowerCase()));
    if (match && !cities.some((c) => c.tz === match.tz)) {
      setCities([...cities, match]);
    }
    setQuery("");
  }

  function remove(tz: string) {
    setCities(cities.filter((c) => c.tz !== tz));
  }

  const fmtTime = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(now);

  const fmtDate = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: tz,
    }).format(now);

  return (
    <div className="wc">
      <h1>World Clock</h1>
      <div className="sub">Compare time across your team's zones</div>

      <div className="addbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Add a city…"
          aria-label="Add a city"
        />
        <button onClick={handleAdd}>+</button>
      </div>

      {suggestions.length > 0 && (
        <div style={{ marginTop: -10, marginBottom: 14 }}>
          {suggestions.map((s) => (
            <div
              key={s.tz}
              className="clockcard"
              style={{ padding: "10px 14px", cursor: "pointer" }}
              onClick={() => {
                setCities([...cities, s]);
                setQuery("");
              }}
            >
              <span className="city">{s.city}</span>
              <span className="zone">add</span>
            </div>
          ))}
        </div>
      )}

      {cities.map((z) => (
        <div className="clockcard" key={z.tz}>
          <div>
            <div className="city">{z.city}</div>
            <div className="zone">{z.tz}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="time">{fmtTime(z.tz)}</div>
            <div className="date">{fmtDate(z.tz)}</div>
          </div>
          {cities.length > 1 && (
            <button className="rm" onClick={() => remove(z.tz)} aria-label="remove">
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
