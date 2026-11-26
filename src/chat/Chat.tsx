import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "../supabase";
import { decrypt, encrypt } from "../crypto";
import { uploadEncrypted, downloadDecrypted, blobToBytes } from "./media";
import type { Member, Message, MediaMeta } from "../types";

function kindOf(mime: string): MediaMeta["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "voice";
  return "document";
}

function decryptMessage(m: Message): Message {
  if (m.content_type === "text") {
    return { ...m, _plain: decrypt(m.ciphertext || "") ?? "🔒" };
  }
  let meta: MediaMeta | null = null;
  try {
    const raw = m.ciphertext ? decrypt(m.ciphertext) : null;
    meta = raw ? (JSON.parse(raw) as MediaMeta) : null;
  } catch {
    meta = null;
  }
  return { ...m, _meta: meta };
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

  const logRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isOwner = me.role === "owner";

  useEffect(() => {
    supabase
      .from("cx_members")
      .select("*")
      .neq("id", me.id)
      .limit(1)
      .then(({ data }) => setThem((data?.[0] as Member) ?? null));
  }, [me.id]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("cx_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(500);
      if (!active) return;
      setMessages(((data as Message[] | null) ?? []).map(decryptMessage));
    })();

    const ch = supabase
      .channel("cx_rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cx_messages" },
        (payload) => {
          const m = decryptMessage(payload.new as Message);
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cx_sos_events" },
        (payload) => {
          const e = payload.new as { member_id: string; lat?: number; lng?: number; created_at: string };
          // the owner is alerted when the other person triggers SOS
          if (isOwner && e.member_id !== me.id) {
            setSosAlert({ lat: e.lat, lng: e.lng, at: e.created_at });
          }
        }
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [isOwner, me.id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function sendText() {
    const text = draft.trim();
    if (!text || !them) return;
    setDraft("");
    const { error } = await supabase.from("cx_messages").insert({
      sender_id: me.id,
      recipient_id: them.id,
      content_type: "text",
      ciphertext: encrypt(text),
    });
    if (error) {
      setDraft(text);
      alert("Send failed: " + error.message);
    }
  }

  async function sendFile(file: File) {
    if (!them) return;
    const kind = kindOf(file.type || "application/octet-stream");
    setBusy(`Sending ${kind}…`);
    try {
      const bytes = await blobToBytes(file);
      const path = await uploadEncrypted(me.id, bytes);
      const meta: MediaMeta = {
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        kind,
      };
      const { error } = await supabase.from("cx_messages").insert({
        sender_id: me.id,
        recipient_id: them.id,
        content_type: kind,
        media_path: path,
        ciphertext: encrypt(JSON.stringify(meta)),
      });
      if (error) throw error;
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
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      })
    );
  }

  async function shareLocation() {
    setMenuOpen(false);
    if (!them) return;
    setBusy("Getting location…");
    try {
      const pos = await getPosition();
      const meta: MediaMeta = {
        mime: "application/geo",
        kind: "location",
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      await supabase.from("cx_messages").insert({
        sender_id: me.id,
        recipient_id: them.id,
        content_type: "location",
        ciphertext: encrypt(JSON.stringify(meta)),
      });
    } catch {
      alert("Couldn't get location. Please allow location permission.");
    } finally {
      setBusy("");
    }
  }

  async function recordAudio(ms: number): Promise<{ path: string; dur: number } | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      const started = Date.now();
      rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      const done = new Promise<void>((res) => (rec.onstop = () => res()));
      rec.start();
      await new Promise((r) => setTimeout(r, ms));
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mime });
      const bytes = await blobToBytes(blob);
      const path = await uploadEncrypted(me.id, bytes);
      return { path, dur: Math.round((Date.now() - started) / 1000) };
    } catch {
      return null;
    }
  }

  // ---- SOS ----
  async function triggerSOS() {
    if (!them || sosActive) return;
    setSosActive(true);
    setBusy("Sending SOS…");
    let lat: number | undefined, lng: number | undefined, acc: number | undefined;
    try {
      const pos = await getPosition();
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      acc = pos.coords.accuracy;
    } catch {
      /* continue without location */
    }
    // record a short audio clip (best-effort)
    const audio = await recordAudio(8000);
    try {
      await supabase.from("cx_sos_events").insert({
        member_id: me.id,
        trigger: "manual",
        lat,
        lng,
        audio_path: audio?.path ?? null,
        status: "active",
      });
      // also drop it into the chat so it's visible both sides
      const meta: MediaMeta = { mime: "application/geo", kind: "location", lat, lng, accuracy: acc, sos: true };
      await supabase.from("cx_messages").insert({
        sender_id: me.id,
        recipient_id: them.id,
        content_type: "location",
        ciphertext: encrypt(JSON.stringify(meta)),
      });
      if (audio) {
        const vmeta: MediaMeta = { mime: "audio", kind: "voice", dur: audio.dur };
        await supabase.from("cx_messages").insert({
          sender_id: me.id,
          recipient_id: them.id,
          content_type: "voice",
          media_path: audio.path,
          ciphertext: encrypt(JSON.stringify(vmeta)),
        });
      }
    } catch (e: any) {
      alert("SOS failed: " + (e?.message || e));
    } finally {
      setBusy("");
      setSosActive(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      const started = Date.now();
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 500 || !them) return;
        setBusy("Sending voice…");
        try {
          const bytes = await blobToBytes(blob);
          const path = await uploadEncrypted(me.id, bytes);
          const meta: MediaMeta = { mime, size: blob.size, kind: "voice", dur: Math.round((Date.now() - started) / 1000) };
          await supabase.from("cx_messages").insert({
            sender_id: me.id,
            recipient_id: them.id,
            content_type: "voice",
            media_path: path,
            ciphertext: encrypt(JSON.stringify(meta)),
          });
        } catch (e: any) {
          alert("Voice send failed: " + (e?.message || e));
        } finally {
          setBusy("");
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert("Microphone permission is needed to record a voice message.");
    }
  }

  return (
    <div className="screen chat">
      <div className="top">
        <div>
          <div className="name">{them?.display_name ?? "Chat"}</div>
          <div className="pill">
            {isOwner ? "full archive" : "clears after 24h"} · encrypted
          </div>
        </div>
        <button className="sos-btn" onClick={triggerSOS} disabled={sosActive} title="Emergency">
          SOS
        </button>
        <button className="lock" title="Hide" onClick={onLock}>
          ⌂
        </button>
      </div>

      {sosAlert && (
        <div className="sos-banner">
          🆘 Emergency alert from {them?.display_name ?? "them"} ·{" "}
          {new Date(sosAlert.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {sosAlert.lat != null && (
            <a
              href={`https://maps.google.com/?q=${sosAlert.lat},${sosAlert.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Open location
            </a>
          )}
          <button onClick={() => setSosAlert(null)}>✕</button>
        </div>
      )}

      <div className="log" ref={logRef}>
        {messages.length === 0 && <div className="hint">No messages yet. Say hello 👋</div>}
        {messages.map((m) => {
          const mine = m.sender_id === me.id;
          const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={m.id} className={`bubble ${mine ? "me" : "you"}`}>
              {m.content_type === "text" ? (
                m._plain
              ) : (
                <MediaBubble msg={m} isOwner={isOwner} onView={setViewer} />
              )}
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
          <button className="icon-btn" title="Attach" onClick={() => setMenuOpen((v) => !v)}>
            ＋
          </button>
          {menuOpen && (
            <div className="attach-menu">
              <button onClick={() => galleryRef.current?.click()}>🖼 Photo / Video</button>
              <button onClick={() => docRef.current?.click()}>📄 Document</button>
              <button onClick={shareLocation}>📍 Location</button>
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

// ---- Media rendering ----
function MediaBubble({
  msg,
  isOwner,
  onView,
}: {
  msg: Message;
  isOwner: boolean;
  onView: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const meta = msg._meta;

  // Location has no media_path — render directly.
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
    const maps = `https://maps.google.com/?q=${meta?.lat},${meta?.lng}`;
    return (
      <div className={`loc ${meta?.sos ? "sos" : ""}`}>
        <div className="loc-ic">{meta?.sos ? "🆘" : "📍"}</div>
        <div className="loc-body">
          <div className="loc-t">{meta?.sos ? "Emergency location" : "Shared location"}</div>
          {meta?.lat != null ? (
            <a href={maps} target="_blank" rel="noreferrer">Open in Maps</a>
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

  if (kind === "image") {
    return (
      <div className="media">
        <img src={url} alt="" className="media-img" onClick={() => onView(url)} />
        <a className="dl" href={url} download={dl}>⬇ Download</a>
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="media">
        <video src={url} controls controlsList="nodownload" className="media-vid" />
        <a className="dl" href={url} download={dl}>⬇ Download</a>
      </div>
    );
  }
  if (kind === "voice") {
    return (
      <div className="media">
        <audio src={url} controls controlsList="nodownload" className="media-aud" />
        {/* voice download only on the admin (owner) side */}
        {isOwner && <a className="dl" href={url} download={dl || "voice.webm"}>⬇ Download</a>}
      </div>
    );
  }
  // document
  return (
    <div className="media file">
      <span className="file-ic">📄</span>
      <span className="file-nm">{meta?.name || "file"}</span>
      <a className="dl" href={url} download={dl}>⬇</a>
    </div>
  );
}
