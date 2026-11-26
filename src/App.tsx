import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { initCrypto, forgetKey } from "./crypto";
import { registerSW } from "./push";
import { callActive } from "./callState";
import { WorldClock } from "./decoy/WorldClock";
import { Login } from "./auth/Login";
import { Verify } from "./auth/Verify";
import { Chat } from "./chat/Chat";
import type { Member } from "./types";

type Phase = "decoy" | "login" | "verify" | "chat";

export function App() {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("decoy");
  const [member, setMember] = useState<Member | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  useEffect(() => {
    registerSW();
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

  // once logged in during the login phase, move to the phrase (verify) step
  useEffect(() => {
    if (phase === "login" && sessionUserId) setPhase("verify");
  }, [sessionUserId, phase]);

  function lock() {
    forgetKey(); // always require the phrase again on re-entry
    setPhase("decoy");
  }

  async function exitApp() {
    forgetKey();
    setPhase("decoy");
    // full wipe: end the login session too (strongest lock we can do)
    try {
      await supabase.auth.signOut();
    } catch {}
    try {
      window.close(); // closes the window on Android; iOS ignores (Apple restriction)
    } catch {}
    // if the tab can't close itself, hard-reset to the decoy, fully logged out
    setTimeout(() => {
      try {
        window.location.replace(window.location.pathname + window.location.search);
      } catch {
        window.location.reload();
      }
    }, 150);
  }

  // Security: when the app is backgrounded/minimized, drop straight back to the
  // decoy and forget the key — so re-opening always starts from the world clock.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden" && !callActive.get()) {
        forgetKey();
        setPhase("decoy");
      }
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  if (!ready) return null;

  if (phase === "decoy") {
    return (
      <WorldClock onUnlock={() => setPhase(sessionUserId ? "verify" : "login")} />
    );
  }

  if (phase === "login") {
    return <Login onBack={() => setPhase("decoy")} />;
  }

  if (phase === "verify") {
    return <Verify onVerified={() => setPhase("chat")} onBack={lock} />;
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
            This account isn't set up yet. Ask the owner to add you.
          </div>
          <button className="btn ghost" onClick={lock} style={{ marginTop: 16 }}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return <Chat me={member} onLock={lock} onExit={exitApp} />;
}
