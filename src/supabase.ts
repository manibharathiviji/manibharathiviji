import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_KEY as string;

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "tz_session", // innocuous key name
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const UNLOCK_CODE = (import.meta.env.VITE_UNLOCK_CODE as string) || "1947";
