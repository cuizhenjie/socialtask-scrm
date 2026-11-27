import { api } from "./api";

type Purpose = "CONTENT" | "PRIVATE_MESSAGE";
const keys = new WeakMap<File, Partial<Record<Purpose, string>>>();

function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function uploadAttachment(file: File, purpose: Purpose) {
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("请选择 5 MB 以内的非空图片");
  const byPurpose = keys.get(file) ?? {};
  const key = byPurpose[purpose] ?? (byPurpose[purpose] = requestId());
  keys.set(file, byPurpose);
  const body = new FormData();
  body.set("purpose", purpose);
  body.set("file", file);
  return api<{ id: number }>("attachments", { method: "POST", body, headers: { "Idempotency-Key": key } });
}
