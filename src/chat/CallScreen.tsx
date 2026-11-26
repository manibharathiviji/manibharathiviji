import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { encrypt, decrypt } from "../crypto";
import { callActive } from "../callState";
import { IconMicOff, IconVideoOff, IconEndCall, IconRecord, IconFlip } from "./icons";
import type { Member } from "../types";

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

export interface ActiveCall {
  id: string;
  kind: "voice" | "video";
  isCaller: boolean;
}

export function CallScreen({
  me,
  them,
  call,
  onEnd,
}: {
  me: Member;
  them: Member | null;
  call: ActiveCall;
  onEnd: () => void;
}) {
  const [status, setStatus] = useState(call.isCaller ? "Calling…" : "Connecting…");
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [facing, setFacing] = useState<"user" | "environment">("user");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const haveRemote = useRef(false);
  const isOwner = me.role === "owner";
  const isVideo = call.kind === "video";

  async function sendSignal(obj: unknown) {
    await supabase.from("cx_signals").insert({
      call_id: call.id,
      sender_id: me.id,
      payload: { e: encrypt(JSON.stringify(obj)) },
    });
  }

  async function handleSignal(raw: any) {
    let obj: any;
    try {
      obj = JSON.parse(decrypt(raw?.e || "") || "");
    } catch {
      return;
    }
    const pc = pcRef.current;
    if (!pc || !obj) return;
    if (obj.t === "answer") {
      await pc.setRemoteDescription(obj.sdp);
      haveRemote.current = true;
      flushIce();
    } else if (obj.t === "offer") {
      await pc.setRemoteDescription(obj.sdp);
      haveRemote.current = true;
      flushIce();
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await sendSignal({ t: "answer", sdp: ans });
    } else if (obj.t === "ice" && obj.c) {
      if (haveRemote.current) {
        try { await pc.addIceCandidate(obj.c); } catch {}
      } else {
        pendingIce.current.push(obj.c);
      }
    }
  }

  function flushIce() {
    const pc = pcRef.current;
    if (!pc) return;
    pendingIce.current.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
    pendingIce.current = [];
  }

  useEffect(() => {
    callActive.set(true);
    let signalCh: ReturnType<typeof supabase.channel> | null = null;
    let callCh: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: isVideo ? { facingMode: "user" } : false,
        });
        localStreamRef.current = stream;
        if (isVideo && localRef.current) localRef.current.srcObject = stream;

        const pc = new RTCPeerConnection(ICE);
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        const remote = new MediaStream();
        remoteStreamRef.current = remote;
        pc.ontrack = (ev) => {
          ev.streams[0].getTracks().forEach((t) => remote.addTrack(t));
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remote;
        };
        pc.onicecandidate = (ev) => {
          if (ev.candidate) sendSignal({ t: "ice", c: ev.candidate.toJSON() });
        };
        pc.onconnectionstatechange = () => {
          const s = pc.connectionState;
          if (s === "connected") {
            setConnected(true);
            setStatus("Connected");
            if (!timer) timer = setInterval(() => setSeconds((x) => x + 1), 1000);
          } else if (s === "failed" || s === "disconnected" || s === "closed") {
            if (s === "failed") setStatus("Connection lost");
          }
        };

        // subscribe to signals for this call
        signalCh = supabase
          .channel(`call_${call.id}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "cx_signals", filter: `call_id=eq.${call.id}` },
            (p) => {
              const row = p.new as any;
              if (row.sender_id !== me.id) handleSignal(row.payload);
            }
          )
          .subscribe();

        // subscribe to call status (remote hang-up / decline)
        callCh = supabase
          .channel(`callstat_${call.id}`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "cx_calls", filter: `id=eq.${call.id}` },
            (p) => {
              const st = (p.new as any).status;
              if (st === "ended" || st === "declined") endLocal();
            }
          )
          .subscribe();

        if (call.isCaller) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignal({ t: "offer", sdp: offer });
          setStatus("Ringing…");
        } else {
          // callee: process the offer already waiting in signals
          const { data } = await supabase
            .from("cx_signals")
            .select("sender_id,payload")
            .eq("call_id", call.id)
            .order("created_at", { ascending: true });
          for (const row of (data as any[]) ?? []) {
            if (row.sender_id !== me.id) await handleSignal(row.payload);
          }
          await supabase.from("cx_calls").update({ status: "accepted" }).eq("id", call.id);
        }
      } catch (e: any) {
        alert("Call failed: " + (e?.message || e) + "\nAllow camera/microphone permission.");
        endLocal();
      }
    })();

    return () => {
      callActive.set(false);
      if (timer) clearInterval(timer);
      if (signalCh) supabase.removeChannel(signalCh);
      if (callCh) supabase.removeChannel(callCh);
      try { recorderRef.current?.stop(); } catch {}
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function endLocal() {
    onEnd();
  }

  async function hangUp() {
    try {
      await supabase.from("cx_calls").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", call.id);
    } catch {}
    endLocal();
  }

  function toggleMute() {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !muted;
    s.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }
  function toggleCam() {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !camOff;
    s.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCamOff(next);
  }

  async function flipCamera() {
    const next = facing === "user" ? "environment" : "user";
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
      const track = ns.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(track);
      const ls = localStreamRef.current;
      if (ls) {
        ls.getVideoTracks().forEach((t) => {
          t.stop();
          ls.removeTrack(t);
        });
        ls.addTrack(track);
        if (localRef.current) localRef.current.srcObject = ls;
      }
      setFacing(next);
    } catch {
      alert("Couldn't switch camera.");
    }
  }

  function toggleRecord() {
    if (recording) {
      try { recorderRef.current?.stop(); } catch {}
      setRecording(false);
      return;
    }
    const stream = remoteStreamRef.current;
    if (!stream || stream.getTracks().length === 0) {
      alert("Nothing to record yet — wait until connected.");
      return;
    }
    const hasVid = stream.getVideoTracks().length > 0;
    const pref = hasVid ? ["video/webm", "video/mp4"] : ["audio/webm", "audio/mp4"];
    const mime = pref.find((m) => MediaRecorder.isTypeSupported(m));
    try {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || "application/octet-stream" });
        const ext = (rec.mimeType || "").includes("mp4") ? "mp4" : (hasVid ? "webm" : "webm");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `call-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e: any) {
      alert("Recording not supported on this device: " + (e?.message || e));
    }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className={`call ${isVideo ? "video" : "voice"}`}>
      {isVideo && <video ref={remoteVideoRef} className="call-remote" autoPlay playsInline />}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {(!isVideo || !connected) && (
        <div className="call-info">
          <div className="call-avatar">{(them?.display_name ?? "?").charAt(0).toUpperCase()}</div>
          <div className="call-name">{them?.display_name ?? "Call"}</div>
          <div className="call-status">{connected ? mmss : status}</div>
        </div>
      )}
      {isVideo && connected && <div className="call-timer">{mmss}</div>}

      {isVideo && (
        <video ref={localRef} className={`call-local ${camOff ? "off" : ""}`} autoPlay playsInline muted />
      )}

      {recording && <div className="rec-dot">● REC</div>}

      <div className="call-controls">
        <button className={`cc ${muted ? "on" : ""}`} onClick={toggleMute} title="Mute">
          <IconMicOff size={24} />
        </button>
        {isVideo && (
          <button className={`cc ${camOff ? "on" : ""}`} onClick={toggleCam} title="Camera">
            <IconVideoOff size={24} />
          </button>
        )}
        {isVideo && (
          <button className="cc" onClick={flipCamera} title="Flip camera">
            <IconFlip size={24} />
          </button>
        )}
        {isOwner && (
          <button className={`cc ${recording ? "rec" : ""}`} onClick={toggleRecord} title="Record">
            <IconRecord size={24} fill={recording} />
          </button>
        )}
        <button className="cc end" onClick={hangUp} title="End">
          <IconEndCall size={26} />
        </button>
      </div>
    </div>
  );
}
