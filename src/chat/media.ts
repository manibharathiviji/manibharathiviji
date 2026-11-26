import { supabase } from "../supabase";
import { encryptBytes, decryptBytes } from "../crypto";

const BUCKET = "cx-media";

/** Encrypt bytes client-side and upload; returns the storage path. */
export async function uploadEncrypted(
  senderId: string,
  bytes: Uint8Array
): Promise<string> {
  const enc = encryptBytes(bytes);
  const path = `${senderId}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Blob([enc]), { contentType: "application/octet-stream" });
  if (error) throw error;
  return path;
}

/** Download + decrypt a media object. Returns decrypted bytes or null. */
export async function downloadDecrypted(path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  return decryptBytes(buf);
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
