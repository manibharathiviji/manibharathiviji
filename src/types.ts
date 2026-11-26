export type Role = "owner" | "guest";

export type ContentType =
  | "text"
  | "image"
  | "video"
  | "document"
  | "voice"
  | "location"
  | "call";

export interface Member {
  id: string;
  role: Role;
  display_name: string | null;
  public_key: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  content_type: ContentType;
  ciphertext: string | null;
  media_path: string | null;
  media_meta: Record<string, unknown> | null;
  reply_to: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
  // client-only decrypted fields
  _plain?: string;
  _meta?: MediaMeta | null;
}

export interface MediaMeta {
  name?: string;
  mime: string;
  size?: number;
  kind: "image" | "video" | "document" | "voice" | "location";
  dur?: number; // seconds, for voice/video
  // location
  lat?: number;
  lng?: number;
  accuracy?: number;
  sos?: boolean;
}

export interface Reaction {
  id: string;
  message_id: string;
  member_id: string;
  emoji: string;
  created_at: string;
}
