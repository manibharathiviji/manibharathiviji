// End-to-end encryption via a SHARED symmetric key (XSalsa20-Poly1305 secretbox).
// Both devices derive the same 32-byte key from a passphrase the two of you agree
// on once (entered on each device). The server only ever stores ciphertext — it
// never sees the passphrase or the key. Either party can decrypt the full history,
// which is exactly what the owner's permanent archive needs.
import _sodium from "libsodium-wrappers";

let sodium: typeof _sodium;
let KEY: Uint8Array | null = null;
const LS_KEY = "tz_dk2"; // cached derived key (innocuous name)

// Fixed app salt so both devices derive the same key from the same passphrase.
// (Phase 1: a shared relationship between two known devices. Can be upgraded to a
// per-pair salt stored in a config row later.)
const SALT_SEED = "magbea-shared-v1";

export async function initCrypto() {
  await _sodium.ready;
  sodium = _sodium;
  const cached = localStorage.getItem(LS_KEY);
  if (cached) {
    try {
      KEY = sodium.from_base64(cached, sodium.base64_variants.ORIGINAL);
    } catch {
      KEY = null;
    }
  }
}

export function hasKey(): boolean {
  return KEY !== null;
}

/** Derive and cache the shared key from the agreed passphrase. */
export function deriveKey(passphrase: string) {
  const salt = sodium
    .crypto_generichash(sodium.crypto_pwhash_SALTBYTES, SALT_SEED);
  // INTERACTIVE limits (64 MiB, 2 ops) — safe and fast on phones.
  KEY = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase.normalize("NFKC"),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT
  );
  localStorage.setItem(
    LS_KEY,
    sodium.to_base64(KEY, sodium.base64_variants.ORIGINAL)
  );
}

export function forgetKey() {
  KEY = null;
  localStorage.removeItem(LS_KEY);
}

const b64 = (u: Uint8Array) => sodium.to_base64(u, sodium.base64_variants.ORIGINAL);
const unb64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

/** Encrypt plaintext. Output: "nonce.cipher" (base64 each). */
export function encrypt(plaintext: string): string {
  if (!KEY) throw new Error("no key");
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(
    sodium.from_string(plaintext),
    nonce,
    KEY
  );
  return `${b64(nonce)}.${b64(cipher)}`;
}

/** Decrypt a "nonce.cipher" payload. Returns plaintext or null if wrong key. */
export function decrypt(payload: string): string | null {
  if (!KEY || !payload) return null;
  try {
    const [n, c] = payload.split(".");
    const plain = sodium.crypto_secretbox_open_easy(unb64(c), unb64(n), KEY);
    return sodium.to_string(plain);
  } catch {
    return null;
  }
}
