import { useState } from "react";
import { supabase } from "../supabase";

export function Login({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
    // on success, App's auth listener swaps the view
  }

  return (
    <div className="screen">
      <div className="center">
        <h1 style={{ marginBottom: 4 }}>Welcome back</h1>
        <div className="sub" style={{ color: "var(--muted)", marginBottom: 20 }}>
          Sign in to continue
        </div>
        <input
          className="field"
          type="email"
          placeholder="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="field"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && signIn()}
        />
        {err && <div className="err">{err}</div>}
        <button className="btn" onClick={signIn} disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
        <button className="btn ghost" onClick={onBack} style={{ marginTop: 8 }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
