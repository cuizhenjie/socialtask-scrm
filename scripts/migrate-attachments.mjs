// Use with a read-only copy of the legacy files while application writers are stopped.
// Without --apply this only checks the local archive and prints a count.
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

const [input, directory, apply] = process.argv.slice(2);
if (!input || !directory || (apply && apply !== "--apply")) {
  throw new Error("Usage: node scripts/migrate-attachments.mjs manifest.json /read-only/uploads [--apply]");
}
const rows = JSON.parse(await readFile(input, "utf8"));
assert.ok(Array.isArray(rows));
const seen = new Set();
const checksum = bytes => createHash("sha256").update(bytes).digest("hex");
for (const row of rows) {
  const { storage_key: key, mime, file_size: size } = row;
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(!seen.has(key) && ["image/png", "image/jpeg"].includes(mime), "Duplicate path or unknown media type");
  seen.add(key);
  const file = await lstat(join(directory, key));
  assert.ok(file.isFile() && !file.isSymbolicLink() && file.size === Number(size) && file.size <= 5 * 1024 * 1024 && file.size > 0, `Size/type mismatch for ${key}`);
}
console.log(`Validated ${rows.length} local files`);
if (apply === "--apply") {
  const root = new URL(process.env.SUPABASE_URL);
  assert.ok(root.protocol === "https:" && root.pathname === "/" && !root.username && !root.password && !root.search && !root.hash, "Use the Ark workspace HTTPS origin");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(key, "Configure SUPABASE_SERVICE_ROLE_KEY");
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const request = (path, init = {}) => fetch(new URL("/storage/v1/" + path, root), {
    ...init, headers: { ...init.headers, ...auth }, redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const bucket = "socialtask-attachments";
  const info = await request(`bucket/${bucket}`);
  assert.ok(info.ok && (await info.json()).public === false, "Destination must be an existing private bucket");
  for (const row of rows) {
    const path = row.storage_key;
    const bytes = await readFile(join(directory, path));
    assert.equal(bytes.length, Number(row.file_size));
    const form = new FormData();
    form.set("cacheControl", "0");
    form.set("", new Blob([bytes], { type: row.mime }), path);
    // No overwrite: repeated runs only accept an existing identical object.
    const result = await request(`object/${bucket}/${path}`, {
      method: "POST", headers: { "x-upsert": "false" }, body: form,
    });
    if (!result.ok && result.status !== 400 && result.status !== 409) throw new Error(`Upload refused (${result.status}) for ${path}`);
    const stored = await request(`object/authenticated/${bucket}/${path}`);
    assert.ok(stored.ok && checksum(Buffer.from(await stored.arrayBuffer())) === checksum(bytes), `SHA-256 mismatch for ${path}`);
  }
  console.log(`Verified SHA-256 for ${rows.length} objects; local archive left unchanged`);
}
