import { supabase } from "./supabase";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC as string;

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("sw.js");
  } catch {
    return null;
  }
}

export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub && Notification.permission === "granted";
}

/** Owner enables SOS push on this device (must be a user gesture). */
export async function enablePush(memberId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "This device/browser doesn't support push." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "Notifications permission was not granted." };

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW());
  if (!reg) return { ok: false, reason: "Could not register the background worker." };
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
    });
  }
  const json: any = sub.toJSON();
  const { error } = await supabase.from("cx_push_subs").upsert(
    {
      member_id: memberId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** Called when SOS fires — asks the server to push the owner. Never throws. */
export async function fireSosPush() {
  try {
    await supabase.functions.invoke("sos-push", { body: {} });
  } catch {
    /* ignore — SOS already stored; push is best-effort */
  }
}
