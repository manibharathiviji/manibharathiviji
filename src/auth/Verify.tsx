import { useState } from "react";
import { supabase } from "../supabase";
import { deriveKey, forgetKey, encrypt, decrypt } from "../crypto";

// Layer 3, disguised as a "region sync" step. The agreed phrase derives the
// shared key; we confirm it against a shared encrypted verifier so a wrong
// phrase is rejected with an innocent-looking error.
const VERIFIER_PLAINTEXT = "MAGBEA-OK";

export function Verify({
  onVerified,
  onBack,
}: {
  onVerified: () => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function submit() {
    const phrase = value.trim();
    if (phrase.length < 4) {
      setErr("That's not a valid region code. Please check and try again.");
      return;
    }
    setErr("");
    setBusy(true);
    setTimeout(async () => {
      try {
        deriveKey(phrase);
        const { data } = await supabase
          .from("cx_vault")
          .select("verifier")
          .eq("id", "shared")
          .maybeSingle();

        if (data?.verifier) {
          // existing verifier — the phrase must decrypt it
          if (decrypt(data.verifier) === VERIFIER_PLAINTEXT) {
            onVerified();
          } else {
            forgetKey();
            setErr("That's not a valid region code. Please check and try again.");
          }
        } else {
          // first setup — define the verifier with this phrase
          const { error } = await supabase
            .from("cx_vault")
            .upsert({ id: "shared", verifier: encrypt(VERIFIER_PLAINTEXT) });
          if (error) {
            forgetKey();
            setErr("Couldn't sync right now. Try again.");
          } else {
            onVerified();
          }
        }
      } catch {
        forgetKey();
        setErr("Couldn't sync on this device. Try again.");
      } finally {
        setBusy(false);
      }
    }, 40);
  }

  return (
    <div className="screen">
      <div className="center">
        <h1 style={{ marginBottom: 4 }}>Sync timezones</h1>
        <div className="sub" style={{ color: "var(--muted)", marginBottom: 20 }}>
          Enter your saved region code to sync your clocks across devices.
        </div>
        <input
          className="field"
          type="password"
          inputMode="text"
          placeholder="Region code"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        {err && <div className="err">{err}</div>}
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? "Syncing…" : "Sync"}
        </button>
        <button className="btn ghost" onClick={onBack} style={{ marginTop: 8 }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
