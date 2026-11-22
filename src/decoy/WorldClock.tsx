import { useEffect, useMemo, useRef, useState } from "react";
import { UNLOCK_CODE } from "../supabase";
import {
  CityRec,
  DEFAULT_CITIES,
  cityId,
  flag,
  offsetLabel,
  offsetMinutes,
  searchCities,
} from "./cities";

const LS = "tz_cities_v2";

function loadCities(): CityRec[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return DEFAULT_CITIES;
}

export function WorldClock({ onUnlock }: { onUnlock: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [cities, setCities] = useState<CityRec[]>(loadCities);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    localStorage.setItem(LS, JSON.stringify(cities));
  }, [cities]);

  // close dropdown on outside tap
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setFocused(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const localTz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const addedIds = useMemo(() => new Set(cities.map(cityId)), [cities]);
  const results = useMemo(() => searchCities(query, 7), [query]);

  const ordered = useMemo(
    () =>
      [...cities].sort(
        (a, b) => offsetMinutes(a.timezone, now) - offsetMinutes(b.timezone, now)
      ),
    [cities, now]
  );

  function submitQuery() {
    const q = query.trim();
    if (!q) return;
    // --- the secret door ---
    if (q === UNLOCK_CODE) {
      setQuery("");
      setFocused(false);
      onUnlock();
      return;
    }
    if (results[0]) addCity(results[0]);
  }

  function addCity(c: CityRec) {
    if (!cities.some((x) => cityId(x) === cityId(c))) setCities([...cities, c]);
    setQuery("");
    setFocused(false);
  }
  function remove(id: string) {
    setCities(cities.filter((c) => cityId(c) !== id));
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
      {/* Hero: local time */}
      <div className="hero">
        <div className="hero-label">Local time · {localTz.replace(/_/g, " ")}</div>
        <div className="hero-time">{fmtTime(localTz)}</div>
        <div className="hero-date">{fmtDate(localTz)}</div>
      </div>

      {/* Search */}
      <div className="searchwrap" ref={boxRef}>
        <div className="searchbar">
          <span className="searchicon">⌕</span>
          <input
            value={query}
            onFocus={() => setFocused(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocused(true);
            }}
            onKeyDown={(e) => e.key === "Enter" && submitQuery()}
            placeholder="Search any city worldwide…"
            aria-label="Search city"
          />
          {query && (
            <button className="clearbtn" onClick={() => setQuery("")} aria-label="clear">
              ×
            </button>
          )}
        </div>

        {focused && results.length > 0 && (
          <div className="dropdown">
            {results.map((c) => {
              const added = addedIds.has(cityId(c));
              return (
                <button
                  key={cityId(c)}
                  className="drow"
                  onClick={() => !added && addCity(c)}
                >
                  <span className="dflag">{flag(c.iso2)}</span>
                  <span className="dinfo">
                    <span className="dcity">{c.city}</span>
                    <span className="dsub">
                      {[c.province, c.country].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  {added ? (
                    <span className="dadded">✓ Added</span>
                  ) : (
                    <span className="doff">{offsetLabel(c.timezone, now)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {focused && query.trim().length >= 2 && results.length === 0 && (
          <div className="dropdown">
            <div className="dempty">No cities found</div>
          </div>
        )}
      </div>

      <div className="section-label">World clock</div>

      <div className="clocklist">
        {ordered.map((c) => {
          const id = cityId(c);
          const isUTC = c.timezone === "UTC";
          return (
            <div className="ccard" key={id}>
              <span className="cflag">{flag(c.iso2)}</span>
              <div className="cinfo">
                <div className="cname">{c.city}</div>
                <div className="csub">
                  <span className="coff">{offsetLabel(c.timezone, now)}</span>
                  {" · "}
                  {isUTC
                    ? "Coordinated Universal Time"
                    : [c.province, c.country].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="ctime">
                <div className="ct-h">{fmtTime(c.timezone)}</div>
                <div className="ct-d">{fmtDate(c.timezone)}</div>
              </div>
              {cities.length > 1 && (
                <button className="crm" onClick={() => remove(id)} aria-label="remove">
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="wc-foot">
        UTC is the global time standard, measured at the Prime Meridian (0°) in
        Greenwich, London. Every zone above is shown as its offset from UTC.
      </div>
    </div>
  );
}
