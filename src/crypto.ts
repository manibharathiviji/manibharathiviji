// End-to-end encryption via a SHARED symmetric key (XSalsa20-Poly1305 secretbox).
// Both devices derive the same 32-byte key from the agreed phrase (Argon2id).
// The key lives ONLY in memory for the current session — it is never written to
// disk — so re-opening the app always requires the phrase again (layer 3).
import _sodium from "libsodium-wrappers-sumo";

let sodium: typeof _sodium;
let KEY: Uint8Array | null = null;

// Fixed app salt so both devices derive the same key from the same phrase.
const SALT_SEED = "magbea-shared-v1";

export async function initCrypto() {
  await _sodium.ready;
  sodium = _sodium;
  // Clean up any legacy cached key from older builds.
  try {
    localStorage.removeItem("tz_dk");
    localStorage.removeItem("tz_dk2");
  } catch {}
}

export function hasKey(): boolean {
  return KEY !== null;
}

/** Derive the shared key from the agreed phrase (in memory only). */
export function deriveKey(passphrase: string) {
  const salt = sodium.crypto_generichash(
    sodium.crypto_pwhash_SALTBYTES,
    SALT_SEED
  );
  KEY = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase.normalize("NFKC"),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT
  );
}

export function forgetKey() {
  KEY = null;
}

const b64 = (u: Uint8Array) => sodium.to_base64(u, sodium.base64_variants.ORIGINAL);
const unb64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

// ---- Text ----
export function encrypt(plaintext: string): string {
  if (!KEY) throw new Error("no key");
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, KEY);
  return `${b64(nonce)}.${b64(cipher)}`;
}
export function decrypt(payload: string): string | null {
  if (!KEY || !payload) return null;
  try {
    const [n, c] = payload.split(".");
    return sodium.to_string(sodium.crypto_secretbox_open_easy(unb64(c), unb64(n), KEY));
  } catch {
    return null;
  }
}

// ---- Binary (media) ----
// Output bytes = nonce (24) || ciphertext. Returned as a single Uint8Array.
export function encryptBytes(data: Uint8Array): Uint8Array {
  if (!KEY) throw new Error("no key");
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(data, nonce, KEY);
  const out = new Uint8Array(nonce.length + cipher.length);
  out.set(nonce, 0);
  out.set(cipher, nonce.length);
  return out;
}
export function decryptBytes(blob: Uint8Array): Uint8Array | null {
  if (!KEY) return null;
  try {
    const n = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = blob.subarray(0, n);
    const cipher = blob.subarray(n);
    return sodium.crypto_secretbox_open_easy(cipher, nonce, KEY);
  } catch {
    return null;
  }
}
