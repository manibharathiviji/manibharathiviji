import { useState } from "react";
import { supabase } from "../supabase";
import { deriveKey, forgetKey, decrypt } from "../crypto";

// Layer 3, disguised as a "region sync" step. The agreed phrase derives the
// shared key. We confirm it by trying to decrypt existing messages — so the
// check is tied to real data and can never lock you out with a stale verifier.
// (If there are no messages yet, the first phrase is accepted and becomes the
// de-facto key; the other device must then match it to read anything.)

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
    // behave like a real region field: reject empty, too-short, or all-numeric
    if (phrase.length < 4 || /^[0-9]+$/.test(phrase)) {
      setErr("That's not a valid timezone. Enter a timezone name, e.g. Asia/Kolkata.");
      return;
    }
    setErr("");
    setBusy(true);
    setTimeout(async () => {
      try {
        deriveKey(phrase);
        const { data } = await supabase
          .from("cx_messages")
          .select("ciphertext")
          .not("ciphertext", "is", null)
          .order("created_at", { ascending: false })
          .limit(10);

        const rows = (data as { ciphertext: string }[] | null) ?? [];
        if (rows.length === 0) {
          // nothing to check against yet — accept as first use
          onVerified();
          return;
        }
        const anyDecrypts = rows.some((r) => decrypt(r.ciphertext) !== null);
        if (anyDecrypts) {
          onVerified();
        } else {
          forgetKey();
          setErr("Incorrect timezone. Please enter the correct timezone.");
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
        <div className="brand" />
        <h1 style={{ marginBottom: 4 }}>Incorrect timezone</h1>
        <div className="sub" style={{ color: "var(--muted)", marginBottom: 20 }}>
          The timezone on this device is incorrect. Please enter the correct
          timezone to continue.
        </div>
        <input
          className="field"
          type="password"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="Correct timezone (e.g. Asia/Kolkata)"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        {err && <div className="err">{err}</div>}
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? "Checking…" : "Set timezone"}
        </button>
        <button className="btn ghost" onClick={onBack} style={{ marginTop: 8 }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
