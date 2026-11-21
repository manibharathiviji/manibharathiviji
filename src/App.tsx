import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { initCrypto } from "./crypto";
import { WorldClock } from "./decoy/WorldClock";
import { Login } from "./auth/Login";
import { Chat } from "./chat/Chat";
import type { Member } from "./types";

type Phase = "decoy" | "login" | "chat";

export function App() {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("decoy");
  const [member, setMember] = useState<Member | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  // boot crypto + read any existing session
  useEffect(() => {
    (async () => {
      await initCrypto();
      const { data } = await supabase.auth.getSession();
      setSessionUserId(data.session?.user.id ?? null);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionUserId(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // load the member record for the signed-in user
  useEffect(() => {
    if (!sessionUserId) {
      setMember(null);
      return;
    }
    supabase
      .from("cx_members")
      .select("*")
      .eq("id", sessionUserId)
      .maybeSingle()
      .then(({ data }) => setMember((data as Member) ?? null));
  }, [sessionUserId]);

  // when a session appears while we're trying to get in, go to chat
  useEffect(() => {
    if (phase === "login" && sessionUserId) setPhase("chat");
  }, [sessionUserId, phase]);

  async function lock() {
    setPhase("decoy");
  }

  if (!ready) return null;

  if (phase === "decoy") {
    return (
      <WorldClock
        onUnlock={() => setPhase(sessionUserId ? "chat" : "login")}
      />
    );
  }

  if (phase === "login") {
    return <Login onBack={() => setPhase("decoy")} />;
  }

  // phase === "chat"
  if (!sessionUserId) {
    setPhase("login");
    return null;
  }
  if (!member) {
    return (
      <div className="screen">
        <div className="center">
          <h1>Almost there</h1>
          <div className="sub" style={{ color: "var(--muted)" }}>
            This account isn't set up as a member yet. Ask the owner to add you.
          </div>
          <button className="btn ghost" onClick={lock} style={{ marginTop: 16 }}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return <Chat me={member} onLock={lock} />;
}
