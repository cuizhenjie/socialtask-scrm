import { ApiError } from "./errors";
import { serviceHeaders, serviceRoleKey, supabaseUrl } from "./supabase";

const BUCKET = "socialtask-attachments";

function objectKey(key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new ApiError(404, "附件文件不存在");
  return key;
}

async function storageRequest(path: string, init: RequestInit): Promise<Response> {
  if (!supabaseUrl || !serviceRoleKey) throw new ApiError(503, "未配置附件存储");
  try {
    return await fetch(`${supabaseUrl}/storage/v1/${path}`, {
      ...init,
      headers: { ...init.headers, ...serviceHeaders() },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "附件存储不可用");
  }
}

export async function storeAttachment(key: string, bytes: Buffer, mime: string) {
  const form = new FormData();
  form.set("cacheControl", "0");
  form.set("", new Blob([Uint8Array.from(bytes)], { type: mime }), key);
  const response = await storageRequest(`object/${BUCKET}/${objectKey(key)}`, {
    method: "POST", headers: { "x-upsert": "false" }, body: form,
  });
  if (!response.ok) throw new ApiError(502, "附件保存失败");
}

export async function readAttachment(key: string): Promise<Response> {
  const response = await storageRequest(`object/authenticated/${BUCKET}/${objectKey(key)}`, { method: "GET" });
  if (response.ok) return response;
  const detail = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (response.status === 404 || (response.status === 400 && [detail.error, detail.code].some(x => x === "not_found" || x === "NoSuchKey"))) {
    throw new ApiError(404, "附件文件不存在");
  }
  throw new ApiError(502, "附件读取失败");
}

export async function removeAttachment(key: string) {
  const response = await storageRequest(`object/${BUCKET}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [objectKey(key)] }),
  });
  if (!response.ok || !Array.isArray(await response.json().catch(() => null))) {
    throw new ApiError(502, "附件清理失败");
  }
}

export async function verifyAttachmentBucket() {
  const response = await storageRequest(`bucket/${BUCKET}`, { method: "GET" });
  if (!response.ok) throw new ApiError(503, "附件存储未就绪");
  const bucket = await response.json();
  if (bucket.public !== false) throw new ApiError(503, "附件存储必须使用私有桶");
}
