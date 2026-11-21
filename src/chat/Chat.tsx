import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { decrypt, encrypt, deriveKey, hasKey } from "../crypto";
import type { Member, Message } from "../types";

export function Chat({ me, onLock }: { me: Member; onLock: () => void }) {
  const [them, setThem] = useState<Member | null>(null);
  const [keyReady, setKeyReady] = useState(hasKey());
  const [pass, setPass] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // Load the other member
  useEffect(() => {
    supabase
      .from("cx_members")
      .select("*")
      .neq("id", me.id)
      .limit(1)
      .then(({ data }) => setThem((data?.[0] as Member) ?? null));
  }, [me.id]);

  // Load history + subscribe to realtime once the key is ready
  useEffect(() => {
    if (!keyReady) return;
    let active = true;

    (async () => {
      const { data } = await supabase
        .from("cx_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(500);
      if (!active) return;
      setMessages(
        (data as Message[] | null)?.map((m) => ({
          ...m,
          _plain: m.content_type === "text" ? decrypt(m.ciphertext || "") ?? "🔒" : "",
        })) ?? []
      );
    })();

    const ch = supabase
      .channel("cx_messages_rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cx_messages" },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) =>
            prev.some((x) => x.id === m.id)
              ? prev
              : [
                  ...prev,
                  {
                    ...m,
                    _plain:
                      m.content_type === "text"
                        ? decrypt(m.ciphertext || "") ?? "🔒"
                        : "",
                  },
                ]
          );
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [keyReady]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  function unlockKey() {
    if (pass.trim().length < 4) return;
    deriveKey(pass.trim());
    setPass("");
    setKeyReady(true);
  }

  async function send() {
    const text = draft.trim();
    if (!text || !them) return;
    setDraft("");
    const ciphertext = encrypt(text);
    const { error } = await supabase.from("cx_messages").insert({
      sender_id: me.id,
      recipient_id: them.id,
      content_type: "text",
      ciphertext,
    });
    if (error) {
      // restore draft on failure
      setDraft(text);
      alert("Send failed: " + error.message);
    }
  }

  // Passphrase gate (shared E2E key)
  if (!keyReady) {
    return (
      <div className="screen">
        <div className="center">
          <h1 style={{ marginBottom: 4 }}>Unlock messages</h1>
          <div className="sub" style={{ color: "var(--muted)", marginBottom: 20 }}>
            Enter the secret phrase you both agreed on. It never leaves this device.
          </div>
          <input
            className="field"
            type="password"
            placeholder="Secret phrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlockKey()}
          />
          <button className="btn" onClick={unlockKey}>
            Unlock
          </button>
          <button className="btn ghost" onClick={onLock} style={{ marginTop: 8 }}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen chat">
      <div className="top">
        <div>
          <div className="name">{them?.display_name ?? "Chat"}</div>
          <div className="pill">
            {me.role === "owner" ? "full archive" : "clears after 24h"} · encrypted
          </div>
        </div>
        <button className="lock" title="Hide" onClick={onLock}>
          ⌂
        </button>
      </div>

      <div className="log" ref={logRef}>
        {messages.length === 0 && (
          <div className="hint">No messages yet. Say hello 👋</div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === me.id;
          const t = new Date(m.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <div key={m.id} className={`bubble ${mine ? "me" : "you"}`}>
              {m._plain}
              <div className="meta">{t}</div>
            </div>
          );
        })}
      </div>

      <div className="composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message"
        />
        <button onClick={send}>➤</button>
      </div>
    </div>
  );
}
