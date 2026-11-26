import { useEffect, useRef, useState, type ChangeEvent, type MutableRefObject } from "react";
import { supabase } from "../supabase";
import { decrypt, encrypt } from "../crypto";
import { uploadEncrypted, downloadDecrypted, blobToBytes } from "./media";
import { WavRecorder } from "./wav";
import { enablePush, isPushEnabled, pushSupported, fireSosPush, fireUrgentNudge } from "../push";
import { IconPlus, IconSend, IconMic, IconStop, IconImage, IconDoc, IconPin, IconLive, IconSos, IconHome, IconExit, IconStar, IconPhone, IconVideo, IconEndCall } from "./icons";
import { CallScreen, type ActiveCall } from "./CallScreen";
import "emoji-picker-element";
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

export function Chat({ me, onLock, onExit }: { me: Member; onLock: () => void; onExit: () => void }) {
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
  const [reactions, setReactions] = useState<Record<string, { member_id: string; emoji: string }[]>>({});
  const [reactTarget, setReactTarget] = useState<string | null>(null);
  const [reactExpanded, setReactExpanded] = useState(false);
  const [starredView, setStarredView] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<{ id: string; kind: "voice" | "video"; callerId: string } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🙏"];

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

  // check whether push alerts are set up on this device (both roles)
  useEffect(() => {
    isPushEnabled().then((on) => setPushOn(on));
  }, []);

  // slash commands (first char '/')
  const SLASH = [
    { cmd: "/urgent", desc: "Ask them to open the app (discreet nudge)" },
  ];
  const slashMatches =
    draft.startsWith("/") ? SLASH.filter((c) => c.cmd.startsWith(draft.trim().toLowerCase())) : [];

  async function runUrgent() {
    setDraft("");
    setBusy("Sending nudge…");
    const ok = await fireUrgentNudge();
    setBusy(ok ? "Nudge sent — they'll get a lock-screen alert." : "Nudge failed (are their alerts enabled?)");
    setTimeout(() => setBusy(""), 2800);
  }

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
      loadReactions();
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cx_messages" }, (p) => {
        const u = p.new as Message;
        setMessages((prev) => prev.map((x) => (x.id === u.id ? { ...x, starred: u.starred } : x)));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "cx_reactions" }, () => loadReactions())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cx_calls" }, (p) => {
        const c = p.new as { id: string; caller_id: string; callee_id: string; kind: "voice" | "video"; status: string };
        if (c.callee_id === me.id && c.status === "ringing") {
          setIncoming({ id: c.id, kind: c.kind, callerId: c.caller_id });
        }
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

  async function loadReactions() {
    const { data } = await supabase.from("cx_reactions").select("message_id,member_id,emoji");
    const map: Record<string, { member_id: string; emoji: string }[]> = {};
    (data ?? []).forEach((r: any) => {
      (map[r.message_id] ??= []).push({ member_id: r.member_id, emoji: r.emoji });
    });
    setReactions(map);
  }

  async function applyReaction(messageId: string, emoji: string) {
    setReactTarget(null);
    setReactExpanded(false);
    const mine = reactions[messageId]?.find((r) => r.member_id === me.id);
    if (mine && mine.emoji === emoji) {
      await supabase.from("cx_reactions").delete().eq("message_id", messageId).eq("member_id", me.id);
    } else {
      await supabase.from("cx_reactions").upsert(
        { message_id: messageId, member_id: me.id, emoji },
        { onConflict: "message_id,member_id" }
      );
    }
    loadReactions();
  }

  // stable handler the native emoji picker calls with the chosen emoji
  const pickRef = useRef<(emoji: string) => void>(() => {});
  pickRef.current = (emoji: string) => {
    if (reactTarget) applyReaction(reactTarget, emoji);
  };

  async function startCall(kind: "voice" | "video") {
    if (!them || activeCall) return;
    const { data, error } = await supabase
      .from("cx_calls")
      .insert({ caller_id: me.id, callee_id: them.id, kind, status: "ringing" })
      .select("id")
      .single();
    if (error || !data) {
      alert("Couldn't start call: " + (error?.message || "unknown"));
      return;
    }
    setActiveCall({ id: (data as any).id, kind, isCaller: true });
  }

  function acceptCall() {
    if (!incoming) return;
    setActiveCall({ id: incoming.id, kind: incoming.kind, isCaller: false });
    setIncoming(null);
  }
  async function declineCall() {
    if (!incoming) return;
    const id = incoming.id;
    setIncoming(null);
    await supabase.from("cx_calls").update({ status: "declined" }).eq("id", id);
  }

  async function toggleStar(messageId: string, current: boolean) {
    setReactTarget(null);
    setReactExpanded(false);
    // optimistic
    setMessages((prev) => prev.map((x) => (x.id === messageId ? { ...x, starred: !current } : x)));
    await supabase.from("cx_messages").update({ starred: !current }).eq("id", messageId);
  }

  function startPress(id: string) {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setReactTarget(id), 420);
  }
  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  async function sendText() {
    const text = draft.trim();
    if (!text || !them) return;
    if (text.toLowerCase() === "/urgent") {
      runUrgent();
      return;
    }
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
        <button className="ic-top" title="Voice call" onClick={() => startCall("voice")}><IconPhone size={17} /></button>
        <button className="ic-top" title="Video call" onClick={() => startCall("video")}><IconVideo size={18} /></button>
        {isOwner && (
          <button
            className={`ic-top ${starredView ? "active" : ""}`}
            title="Starred messages"
            onClick={() => setStarredView((v) => !v)}
          >
            <IconStar size={19} fill={starredView} />
          </button>
        )}
        <button className="sos-btn" onClick={triggerSOS} disabled={sosActive} title="Emergency">
          <IconSos size={15} /> SOS
        </button>
        <button className="ic-top" title="Home" onClick={onLock}><IconHome size={20} /></button>
        <button className="ic-top exit" title="Exit" onClick={onExit}><IconExit size={20} /></button>
      </div>

      {!pushOn && (
        pushSupported() ? (
          <div className="enable-banner">
            🔔 Turn on alerts so SOS and urgent nudges reach you when the app is closed.
            <button onClick={enableAlerts} disabled={pushBusy}>
              {pushBusy ? "…" : "Enable"}
            </button>
          </div>
        ) : (
          <div className="enable-banner">
            📱 For alerts on iPhone: open this in <b>Safari</b> (not Chrome) →
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
        {(() => {
          const shown = starredView ? messages.filter((m) => m.starred) : messages;
          if (shown.length === 0)
            return (
              <div className="hint">
                {starredView ? "No starred messages yet." : "No messages yet. Say hello 👋"}
              </div>
            );
          return shown.map((m) => {
            const mine = m.sender_id === me.id;
            const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const rx = reactions[m.id];
            return (
              <div
                key={m.id}
                className={`bubble ${mine ? "me" : "you"} ${m.starred ? "starred" : ""}`}
                onPointerDown={() => startPress(m.id)}
                onPointerUp={cancelPress}
                onPointerMove={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
              >
                {!isOwner && m.starred && (
                  <div className="starred-note"><IconStar size={12} fill /> Admin starred this</div>
                )}
                {m.content_type === "text" ? m._plain : <MediaBubble msg={m} isOwner={isOwner} onView={setViewer} />}
                {rx && rx.length > 0 && (
                  <div className="react-chips">
                    {rx.map((r, i) => (
                      <span key={i}>{r.emoji}</span>
                    ))}
                  </div>
                )}
                <div className="meta">
                  {isOwner && m.starred && <IconStar size={11} fill />} {t}
                </div>
              </div>
            );
          });
        })()}
      </div>

      {busy && <div className="hint">{busy}</div>}

      {slashMatches.length > 0 && (
        <div className="slash-menu">
          <div className="slash-head">Quick commands</div>
          {slashMatches.map((c) => (
            <button key={c.cmd} onClick={() => c.cmd === "/urgent" && runUrgent()}>
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div className="composer">
        <input ref={galleryRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={onPickFile} />
        <input ref={docRef} type="file" style={{ display: "none" }} onChange={onPickFile} />
        <div className="attach-wrap">
          <button className="icon-btn" title="Attach" onClick={() => setMenuOpen((v) => !v)}><IconPlus size={22} /></button>
          {menuOpen && (
            <div className="attach-menu">
              <button onClick={() => galleryRef.current?.click()}><span className="mi-ic img"><IconImage size={17} /></span> Photo / Video</button>
              <button onClick={() => docRef.current?.click()}><span className="mi-ic doc"><IconDoc size={17} /></span> Document</button>
              <button onClick={shareCurrent}><span className="mi-ic pin"><IconPin size={17} /></span> Current location</button>
              <button onClick={() => startLive(8)}><span className="mi-ic live"><IconLive size={17} /></span> Live · 8 hours</button>
              <button onClick={() => startLive(24)}><span className="mi-ic live"><IconLive size={17} /></span> Live · 24 hours</button>
              <button onClick={customLive}><span className="mi-ic live"><IconLive size={17} /></span> Live · custom…</button>
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
          <button className="send" onClick={sendText} title="Send"><IconSend size={18} /></button>
        ) : (
          <button className={`send ${recording ? "rec" : ""}`} onClick={toggleRecord} title="Voice message">
            {recording ? <IconStop size={18} /> : <IconMic size={20} />}
          </button>
        )}
      </div>

      {reactTarget && (
        <div
          className="react-backdrop"
          onClick={() => {
            setReactTarget(null);
            setReactExpanded(false);
          }}
        >
          {!reactExpanded ? (
            <div className="react-bar" onClick={(e) => e.stopPropagation()}>
              {REACTIONS.map((em) => (
                <button key={em} onClick={() => applyReaction(reactTarget, em)}>{em}</button>
              ))}
              <button className="more" onClick={() => setReactExpanded(true)} title="More">＋</button>
              {isOwner && (
                <button
                  className="star-act"
                  onClick={() => toggleStar(reactTarget, !!messages.find((m) => m.id === reactTarget)?.starred)}
                  title="Star"
                >
                  <IconStar size={22} fill={!!messages.find((m) => m.id === reactTarget)?.starred} />
                </button>
              )}
            </div>
          ) : (
            <div className="emoji-sheet" onClick={(e) => e.stopPropagation()}>
              <EmojiPickerEl onPickRef={pickRef} />
            </div>
          )}
        </div>
      )}

      {viewer && (
        <div className="viewer" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" />
          <button className="viewer-close">✕</button>
        </div>
      )}

      {incoming && !activeCall && (
        <div className="incoming">
          <div className="call-avatar big">{(them?.display_name ?? "?").charAt(0).toUpperCase()}</div>
          <div className="call-name">{them?.display_name ?? "Incoming"}</div>
          <div className="call-status">Incoming {incoming.kind} call…</div>
          <div className="incoming-actions">
            <button className="cc end" onClick={declineCall} title="Decline"><IconEndCall size={26} /></button>
            <button className="cc accept" onClick={acceptCall} title="Accept"><IconPhone size={24} /></button>
          </div>
        </div>
      )}

      {activeCall && (
        <CallScreen me={me} them={them} call={activeCall} onEnd={() => setActiveCall(null)} />
      )}
    </div>
  );
}

// Full searchable emoji keyboard (web component), created imperatively to avoid
// custom-element JSX typing. Calls the latest handler via a ref.
function EmojiPickerEl({ onPickRef }: { onPickRef: MutableRefObject<(e: string) => void> }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.createElement("emoji-picker") as HTMLElement;
    el.className = "dark";
    const h = (ev: Event) => onPickRef.current((ev as CustomEvent).detail.unicode);
    el.addEventListener("emoji-click", h);
    host.current?.appendChild(el);
    return () => {
      el.removeEventListener("emoji-click", h);
      el.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="epick-host" />;
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
