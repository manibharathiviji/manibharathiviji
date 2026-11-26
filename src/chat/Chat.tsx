import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "../supabase";
import { decrypt, encrypt } from "../crypto";
import { uploadEncrypted, downloadDecrypted, blobToBytes } from "./media";
import { WavRecorder } from "./wav";
import { enablePush, isPushEnabled, pushSupported, fireSosPush } from "../push";
import type { Member, Message, MediaMeta } from "../types";

function kindOf(mime: string): MediaMeta["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "voice";
  return "document";
}

function decryptMessage(m: Message): Message {
  if (m.content_type === "text") return { ...m, _plain: decrypt(m.ciphertext || "") ?? "🔒" };
  let meta: MediaMeta | null = null;
  try {
    const raw = m.ciphertext ? decrypt(m.ciphertext) : null;
    meta = raw ? (JSON.parse(raw) as MediaMeta) : null;
  } catch {
    meta = null;
  }
  return { ...m, _meta: meta };
}

interface PeerLive {
  lat: number;
  lng: number;
  at: number;
}

export function Chat({ me, onLock }: { me: Member; onLock: () => void }) {
  const [them, setThem] = useState<Member | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [sosAlert, setSosAlert] = useState<{ lat?: number; lng?: number; at: string } | null>(null);
  const [sosActive, setSosActive] = useState(false);
  const [myLiveUntil, setMyLiveUntil] = useState<number | null>(null);
  const [peerLive, setPeerLive] = useState<PeerLive | null>(null);
  const [pushOn, setPushOn] = useState(true); // assume on until checked
  const [pushBusy, setPushBusy] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const voiceRecRef = useRef<WavRecorder | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastLiveInsert = useRef(0);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOwner = me.role === "owner";

  useEffect(() => {
    supabase.from("cx_members").select("*").neq("id", me.id).limit(1)
      .then(({ data }) => setThem((data?.[0] as Member) ?? null));
  }, [me.id]);

  // owner: check whether SOS push alerts are set up on this device
  useEffect(() => {
    if (!isOwner) return;
    isPushEnabled().then((on) => setPushOn(on));
  }, [isOwner]);

  async function enableAlerts() {
    setPushBusy(true);
    const res = await enablePush(me.id);
    setPushBusy(false);
    if (res.ok) setPushOn(true);
    else alert(res.reason || "Couldn't enable alerts.");
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("cx_messages").select("*").order("created_at", { ascending: true }).limit(500);
      if (!active) return;
      setMessages(((data as Message[] | null) ?? []).map(decryptMessage));
      // latest live location from the other person (last 10 min)
      const { data: loc } = await supabase
        .from("cx_locations").select("member_id,lat,lng,created_at")
        .eq("kind", "live").order("created_at", { ascending: false }).limit(5);
      const peer = (loc ?? []).find((l: any) => l.member_id !== me.id);
      if (peer && Date.now() - new Date(peer.created_at).getTime() < 10 * 60000)
        setPeerLive({ lat: peer.lat, lng: peer.lng, at: new Date(peer.created_at).getTime() });
    })();

    const ch = supabase
      .channel("cx_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cx_messages" }, (p) => {
        const m = decryptMessage(p.new as Message);
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cx_sos_events" }, (p) => {
        const e = p.new as { member_id: string; lat?: number; lng?: number; created_at: string };
        if (isOwner && e.member_id !== me.id) setSosAlert({ lat: e.lat, lng: e.lng, at: e.created_at });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cx_locations" }, (p) => {
        const l = p.new as { member_id: string; lat: number; lng: number; kind: string };
        if (l.member_id !== me.id && l.kind === "live")
          setPeerLive({ lat: l.lat, lng: l.lng, at: Date.now() });
      })
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [isOwner, me.id]);

  // cleanup live watch on unmount
  useEffect(() => {
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function insert(row: Record<string, unknown>) {
    const { error } = await supabase.from("cx_messages").insert(row);
    if (error) throw error;
  }

  async function sendText() {
    const text = draft.trim();
    if (!text || !them) return;
    setDraft("");
    try {
      await insert({ sender_id: me.id, recipient_id: them.id, content_type: "text", ciphertext: encrypt(text) });
    } catch (e: any) {
      setDraft(text);
      alert("Send failed: " + (e?.message || e));
    }
  }

  async function sendFile(file: File) {
    if (!them) return;
    const kind = kindOf(file.type || "application/octet-stream");
    setBusy(`Sending ${kind}…`);
    try {
      const path = await uploadEncrypted(me.id, await blobToBytes(file));
      const meta: MediaMeta = { name: file.name, mime: file.type || "application/octet-stream", size: file.size, kind };
      await insert({ sender_id: me.id, recipient_id: them.id, content_type: kind, media_path: path, ciphertext: encrypt(JSON.stringify(meta)) });
    } catch (e: any) {
      alert("Send failed: " + (e?.message || e));
    } finally {
      setBusy("");
    }
  }

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    setMenuOpen(false);
    if (f) sendFile(f);
  }

  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
    );
  }

  async function shareCurrent() {
    setMenuOpen(false);
    if (!them) return;
    setBusy("Getting location…");
    try {
      const pos = await getPosition();
      const meta: MediaMeta = { mime: "application/geo", kind: "location", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      await insert({ sender_id: me.id, recipient_id: them.id, content_type: "location", ciphertext: encrypt(JSON.stringify(meta)) });
    } catch {
      alert("Couldn't get location. Please allow location permission.");
    } finally {
      setBusy("");
    }
  }

  async function startLive(hours: number) {
    setMenuOpen(false);
    if (!them || !hours || hours <= 0) return;
    const until = Date.now() + hours * 3600 * 1000;
    setMyLiveUntil(until);
    try {
      const meta: MediaMeta = { mime: "application/geo", kind: "location", live: true, until } as any;
      await insert({ sender_id: me.id, recipient_id: them.id, content_type: "location", ciphertext: encrypt(JSON.stringify(meta)) });
    } catch {}
    // begin watching; push updates (throttled) to cx_locations
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastLiveInsert.current < 15000) return;
        lastLiveInsert.current = now;
        await supabase.from("cx_locations").insert({
          member_id: me.id, lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, kind: "live",
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    liveTimerRef.current = setTimeout(stopLive, hours * 3600 * 1000);
  }

  function stopLive() {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    setMyLiveUntil(null);
  }

  function customLive() {
    const h = Number(prompt("Share live location for how many hours?", "2"));
    if (h && h > 0) startLive(h);
  }

  // ---- SOS ----
  async function triggerSOS() {
    if (!them || sosActive) return;
    setSosActive(true);
    setBusy("Sending SOS…");
    let lat: number | undefined, lng: number | undefined, acc: number | undefined;
    try {
      const pos = await getPosition();
      lat = pos.coords.latitude; lng = pos.coords.longitude; acc = pos.coords.accuracy;
    } catch {}
    try {
      // 1) alert admin immediately (DB row + push notification)
      await supabase.from("cx_sos_events").insert({ member_id: me.id, trigger: "manual", lat, lng, status: "active" });
      fireSosPush();
      const meta: MediaMeta = { mime: "application/geo", kind: "location", lat, lng, accuracy: acc, sos: true };
      await insert({ sender_id: me.id, recipient_id: them.id, content_type: "location", ciphertext: encrypt(JSON.stringify(meta)) });
      // 2) start live location for 1 hour
      startLive(1);
      // 3) record 30s audio and post it
      setBusy("SOS sent — recording audio (30s)…");
      const rec = new WavRecorder();
      await rec.start();
      await new Promise((r) => setTimeout(r, 30000));
      const { blob, dur } = rec.stop();
      const path = await uploadEncrypted(me.id, await blobToBytes(blob));
      const vmeta: MediaMeta = { mime: "audio/wav", kind: "voice", dur };
      await insert({ sender_id: me.id, recipient_id: them.id, content_type: "voice", media_path: path, ciphertext: encrypt(JSON.stringify(vmeta)) });
    } catch (e: any) {
      alert("SOS error: " + (e?.message || e));
    } finally {
      setBusy("");
      setSosActive(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      const rec = voiceRecRef.current;
      voiceRecRef.current = null;
      setRecording(false);
      if (!rec || !them) return;
      const { blob, dur } = rec.stop();
      if (blob.size < 1000) return;
      setBusy("Sending voice…");
      try {
        const path = await uploadEncrypted(me.id, await blobToBytes(blob));
        const meta: MediaMeta = { mime: "audio/wav", kind: "voice", dur };
        await insert({ sender_id: me.id, recipient_id: them.id, content_type: "voice", media_path: path, ciphertext: encrypt(JSON.stringify(meta)) });
      } catch (e: any) {
        alert("Voice send failed: " + (e?.message || e));
      } finally {
        setBusy("");
      }
      return;
    }
    try {
      const rec = new WavRecorder();
      await rec.start();
      voiceRecRef.current = rec;
      setRecording(true);
    } catch {
      alert("Microphone permission is needed to record a voice message.");
    }
  }

  const peerLiveActive = peerLive && Date.now() - peerLive.at < 3 * 60000;

  return (
    <div className="screen chat">
      <div className="top">
        <div className="avatar">{(them?.display_name ?? "?").charAt(0).toUpperCase()}</div>
        <div className="top-info">
          <div className="name">{them?.display_name ?? "Chat"}</div>
          <div className="pill">
            <span className="dot" /> {isOwner ? "full archive" : "clears after 24h"} · encrypted
          </div>
        </div>
        <button className="sos-btn" onClick={triggerSOS} disabled={sosActive} title="Emergency">SOS</button>
        <button className="lock" title="Hide" onClick={onLock}>⌂</button>
      </div>

      {isOwner && !pushOn && (
        pushSupported() ? (
          <div className="enable-banner">
            🔔 Turn on emergency alerts so SOS reaches you even when the app is closed.
            <button onClick={enableAlerts} disabled={pushBusy}>
              {pushBusy ? "…" : "Enable"}
            </button>
          </div>
        ) : (
          <div className="enable-banner">
            📱 For SOS alarms on iPhone: open this in <b>Safari</b> (not Chrome) →
            Share → <b>Add to Home Screen</b>, then open that app and enable alerts.
          </div>
        )
      )}

      {sosAlert && (
        <div className="sos-banner">
          🆘 Emergency from {them?.display_name ?? "them"} ·{" "}
          {new Date(sosAlert.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {sosAlert.lat != null && (
            <a href={`https://maps.google.com/?q=${sosAlert.lat},${sosAlert.lng}`} target="_blank" rel="noreferrer">Open location</a>
          )}
          <button onClick={() => setSosAlert(null)}>✕</button>
        </div>
      )}

      {peerLiveActive && (
        <div className="live-banner">
          🟢 {them?.display_name ?? "They"} sharing live location
          <a href={`https://maps.google.com/?q=${peerLive!.lat},${peerLive!.lng}`} target="_blank" rel="noreferrer">Open latest</a>
        </div>
      )}
      {myLiveUntil && (
        <div className="live-banner me">
          🟢 You're sharing live location until{" "}
          {new Date(myLiveUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          <button onClick={stopLive}>Stop</button>
        </div>
      )}

      <div className="log" ref={logRef}>
        {messages.length === 0 && <div className="hint">No messages yet. Say hello 👋</div>}
        {messages.map((m) => {
          const mine = m.sender_id === me.id;
          const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={m.id} className={`bubble ${mine ? "me" : "you"}`}>
              {m.content_type === "text" ? m._plain : <MediaBubble msg={m} isOwner={isOwner} onView={setViewer} />}
              <div className="meta">{t}</div>
            </div>
          );
        })}
      </div>

      {busy && <div className="hint">{busy}</div>}

      <div className="composer">
        <input ref={galleryRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={onPickFile} />
        <input ref={docRef} type="file" style={{ display: "none" }} onChange={onPickFile} />
        <div className="attach-wrap">
          <button className="icon-btn" title="Attach" onClick={() => setMenuOpen((v) => !v)}>＋</button>
          {menuOpen && (
            <div className="attach-menu">
              <button onClick={() => galleryRef.current?.click()}>🖼 Photo / Video</button>
              <button onClick={() => docRef.current?.click()}>📄 Document</button>
              <button onClick={shareCurrent}>📍 Current location</button>
              <button onClick={() => startLive(8)}>🟢 Live · 8 hours</button>
              <button onClick={() => startLive(24)}>🟢 Live · 24 hours</button>
              <button onClick={customLive}>🟢 Live · custom…</button>
            </div>
          )}
        </div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendText()}
          placeholder={recording ? "Recording…" : "Message"}
          disabled={recording}
        />
        {draft.trim() ? (
          <button className="send" onClick={sendText}>➤</button>
        ) : (
          <button className={`send ${recording ? "rec" : ""}`} onClick={toggleRecord} title="Voice message">
            {recording ? "⏹" : "🎤"}
          </button>
        )}
      </div>

      {viewer && (
        <div className="viewer" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" />
          <button className="viewer-close">✕</button>
        </div>
      )}
    </div>
  );
}

function MediaBubble({ msg, isOwner, onView }: { msg: Message; isOwner: boolean; onView: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const meta = msg._meta;
  const isLocation = msg.content_type === "location";

  useEffect(() => {
    if (isLocation) return;
    let revoked = false;
    let objUrl: string | null = null;
    (async () => {
      if (!msg.media_path) return setFailed(true);
      const bytes = await downloadDecrypted(msg.media_path);
      if (revoked) return;
      if (!bytes) return setFailed(true);
      objUrl = URL.createObjectURL(new Blob([bytes], { type: meta?.mime || "application/octet-stream" }));
      setUrl(objUrl);
    })();
    return () => {
      revoked = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.media_path]);

  if (isLocation) {
    const live = (meta as any)?.live;
    const maps = `https://maps.google.com/?q=${meta?.lat},${meta?.lng}`;
    return (
      <div className={`loc ${meta?.sos ? "sos" : ""}`}>
        <div className="loc-ic">{meta?.sos ? "🆘" : live ? "🟢" : "📍"}</div>
        <div className="loc-body">
          <div className="loc-t">
            {meta?.sos ? "Emergency location" : live ? "Live location started" : "Shared location"}
          </div>
          {meta?.lat != null ? (
            <a href={maps} target="_blank" rel="noreferrer">Open in Maps</a>
          ) : live ? (
            <span className="loc-sub">tracking… see the live banner above</span>
          ) : (
            <span className="loc-sub">location unavailable</span>
          )}
        </div>
      </div>
    );
  }

  if (failed) return <span>🔒 unavailable</span>;
  if (!url) return <span className="media-load">Loading…</span>;

  const kind = msg.content_type;
  const dl = meta?.name || `file.${(meta?.mime || "bin").split("/")[1] || "bin"}`;

  if (kind === "image")
    return (
      <div className="media">
        <img src={url} alt="" className="media-img" onClick={() => onView(url)} />
        <a className="dl" href={url} download={dl}>⬇ Download</a>
      </div>
    );
  if (kind === "video")
    return (
      <div className="media">
        <video src={url} controls controlsList="nodownload" className="media-vid" />
        <a className="dl" href={url} download={dl}>⬇ Download</a>
      </div>
    );
  if (kind === "voice")
    return (
      <div className="media">
        <audio src={url} controls controlsList="nodownload" className="media-aud" />
        {isOwner && <a className="dl" href={url} download={dl || "voice.wav"}>⬇ Download</a>}
      </div>
    );
  return (
    <div className="media file">
      <span className="file-ic">📄</span>
      <span className="file-nm">{meta?.name || "file"}</span>
      <a className="dl" href={url} download={dl}>⬇</a>
    </div>
  );
}
