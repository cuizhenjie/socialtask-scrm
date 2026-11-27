// Isolated PostgreSQL engine (PGlite) + synthetic HTTP Data API and Storage, real Next standalone.
// No production URL, credentials or external requests are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { PGlite } = requireWeb("@electric-sql/pglite");
const sharp = requireWeb("sharp");
const pg = new PGlite();
const service = "fixture-service-role";
const cron = "fixture-cron-token-is-not-a-real-secret";
const corp = "ww-qa-only";
const cbToken = "fixture-callback";
const aes = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const password = "isolated-password-01";
const standby = "backup-test-password";
const objects = new Map();
const rpcErrors = [];
let gateway, child, appLog = "", brokenStorage = false, failFinish = "", statusReport = 0;
const forward = /^\/rest\/v1\/rpc\/(api_query|api_exec)$/;
const bucket = "socialtask-attachments";
const reply = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
const start = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
const execSql = async (name) => pg.exec(await readFile(new URL("../supabase/" + name, import.meta.url), "utf8"));

try {
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);");
  await execSql("bootstrap.sql");
  await execSql("migrations/20261127_next_runtime.sql");
  await execSql("storage.sql");
  await execSql("migrations/20261128_attachment_uploads.sql");
  await execSql("migrations/20261128_attachment_uploads.sql");
  await execSql("migrations/20261127_next_runtime.sql"); // safe re-application
  assert.equal((await pg.query("SELECT has_function_privilege('anon','public.api_exec(text)','EXECUTE') AS allowed")).rows[0].allowed, false);
  assert.equal((await pg.query("SELECT has_function_privilege('service_role','public.socialtask_bootstrap_admin(text,text)','EXECUTE') AS allowed")).rows[0].allowed, false);
  statusReport++;

  gateway = createServer(async (req, res) => {
    try {
      if (req.headers.apikey !== service || req.headers.authorization !== `Bearer ${service}`) return reply(res, 401, {});
      const { pathname: path } = new URL(req.url, "http://127.0.0.1");
      const rpc = path.match(forward);
      if (rpc && req.method === "POST") {
        const parts = [];
        for await (const part of req) parts.push(part);
        const { p_sql } = JSON.parse(Buffer.concat(parts));
        const fault = p_sql.startsWith("SELECT public.socialtask_finish_upload") ? failFinish : "";
        if (fault) failFinish = "";
        if (fault === "before") return reply(res, 503, {});
        const { rows: [row] } = await pg.transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE service_role");
          return tx.query(`SELECT public.${rpc[1]}($1::text) AS data`, [p_sql]);
        });
        return reply(res, fault === "after" ? 503 : 200, fault === "after" ? {} : row.data);
      }
      if (brokenStorage) return reply(res, 503, {});
      if (path === `/storage/v1/bucket/${bucket}` && req.method === "GET") {
        return reply(res, 200, (await pg.query("SELECT * FROM storage.buckets")).rows[0]);
      }
      const key = path.split("/").at(-1);
      if (req.method === "POST" && path === `/storage/v1/object/${bucket}/${key}` && /^[a-f0-9]{64}$/.test(key)) {
        if (objects.has(key)) return reply(res, 400, { code: "ResourceAlreadyExists" });
        const incoming = new Request("http://127.0.0.1", { method: "POST", headers: req.headers, body: req, duplex: "half" });
        const data = await incoming.formData();
        assert.equal(req.headers["x-upsert"], "false");
        objects.set(key, Buffer.from(await data.get("").arrayBuffer()));
        return reply(res, 200, { Key: `${bucket}/${key}` });
      }
      if (req.method === "GET" && path === `/storage/v1/object/authenticated/${bucket}/${key}`) {
        if (!objects.has(key)) return reply(res, 400, { error: "not_found" });
        return res.end(objects.get(key));
      }
      if (req.method === "DELETE" && path === `/storage/v1/object/${bucket}`) {
        const parts = [];
        for await (const part of req) parts.push(part);
        const { prefixes } = JSON.parse(Buffer.concat(parts));
        return reply(res, 200, prefixes.filter(k => objects.delete(k)).map(name => ({ name })));
      }
      reply(res, 404, {});
    } catch (e) {
      rpcErrors.push(`${e.code ?? ""} ${e.message}`);
      reply(res, 400, { code: e.code, message: e.message });
    }
  });
  const mockPort = await start(gateway);
  const reserve = createServer();
  const port = await start(reserve);
  await new Promise(resolve => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: fileURLToPath(new URL("../apps/web/.next/standalone/", import.meta.url)),
    env: {
      PATH: process.env.PATH, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1", PORT: String(port),
      SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_SERVICE_ROLE_KEY: service,
      BOOTSTRAP_ADMIN_USERNAME: "fixture-admin", BOOTSTRAP_ADMIN_PASSWORD: password,
      CRON_SECRET: cron, WECOM_ENABLED: "false", WECOM_CALLBACK_ENABLED: "true", WECOM_CORP_ID: corp,
      WECOM_CALLBACK_TOKEN: cbToken, WECOM_ENCODING_AES_KEY: aes.toString("base64").replace(/=$/, ""),
    },
  });
  child.stdout.on("data", data => { appLog += data; });
  child.stderr.on("data", data => { appLog += data; });
  for (let i = 0; i < 100; i++) {
    if (await fetch(base + "/api/v1/health").then(r => r.ok).catch(() => false)) break;
    await delay(100);
  }
  async function call(path, { expected = 200, method = "GET", token, body, headers = {}, output = "json" } = {}) {
    const response = await fetch(base + path, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
        ...(body && Object.getPrototypeOf(body) === Object.prototype ? { "Content-Type": "application/json" } : {}) },
      body: body && Object.getPrototypeOf(body) === Object.prototype ? JSON.stringify(body) : body,
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, expected, `${method} ${path}: ${response.status === expected ? "" : await response.clone().text()}`);
    if (output === "response") return response;
    if (output === "text") return response.text();
    if (output === "bytes") return Buffer.from(await response.arrayBuffer());
    return response.json();
  }
  const api = (path, options) => call("/api/v1/" + path, options);
  const post = (path, token, body, expected) => api(path, { token, body, expected, method: "POST" });
  const auth = (username, value = password, expected) => post("auth/login", null, { username, password: value }, expected);

  await api("ready");
  brokenStorage = true;
  await api("ready", { expected: 503 });
  brokenStorage = false;
  const [one, two] = await Promise.all([auth("fixture-admin"), auth("fixture-admin")]);
  const admin = one.access_token;
  assert.ok(admin && two.access_token && admin !== two.access_token);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 1);
  assert.equal((await pg.query("SELECT public.socialtask_bootstrap_admin($1,$2) AS created", ["unexpected", "ignored"])).rows[0].created, false);
  await auth("fixture-admin", standby, 401);
  const browserSession = await call("/api/auth/login", { method: "POST", body: { username: "fixture-admin", password }, output: "response" });
  assert.match(browserSession.headers.get("set-cookie"), /HttpOnly/i);
  assert.ok(!("access_token" in await browserSession.json()));
  const Cookie = browserSession.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/api/proxy/me", { headers: { Cookie } })).role, "admin");
  await api("me", { headers: { Cookie }, expected: 401 });
  statusReport++;

  await post("people/groups", admin, { name: "测试组" });
  const worker = await post("people", admin, { personNo: "001", name: "Synthetic Worker", personType: "support", groupName: "测试组", wecomUserId: "fixture_worker" });
  await post(`people/${worker.id}/credentials`, admin, { username: "fixture-worker", password: standby });
  const workerToken = (await auth("fixture-worker", standby)).access_token;
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  async function upload(purpose, bearer, { key, payload = png, name = "fixture.png", expected } = {}) {
    const body = new FormData();
    body.set("purpose", purpose);
    body.set("file", new Blob([payload], { type: "image/png" }), name);
    return api("attachments", { method: "POST", token: bearer, body, expected, headers: key ? { "Idempotency-Key": key } : {} });
  }
  await upload("CONTENT", workerToken, { expected: 403 });
  await upload("CONTENT", admin, { payload: Buffer.alloc(5 * 1024 * 1024 + 1), expected: 413 });
  const fake = Buffer.concat([png.subarray(0, 33), png.subarray(-12)]); // Valid-looking header/footer, no pixels.
  await upload("CONTENT", admin, { payload: fake, expected: 400 });
  assert.equal(objects.size, 0);
  const browserUpload = new FormData();
  browserUpload.set("purpose", "CONTENT");
  browserUpload.set("file", new Blob([png], { type: "image/png" }), "material.png");
  await call("/api/proxy/attachments", {
    method: "POST", body: browserUpload, expected: 403,
    headers: { Cookie, Origin: "http://not-the-workbench.invalid" },
  });
  const file = await call("/api/proxy/attachments", {
    method: "POST", body: browserUpload,
    headers: { Cookie, Origin: base, "Idempotency-Key": "f49b3cd9-f9ef-4c98-a7ca-4be4cb898c0f" },
  });
  await api(`attachments/${file.id}`, { token: workerToken, expected: 403 });
  assert.deepEqual(await api(`attachments/${file.id}`, { token: admin, output: "bytes" }), png);
  const material = await post("content-packages", admin, { title: "验证素材", body: "隔离样例内容", assetIds: [file.id] });
  await post(`content-packages/${material.id}/review`, admin, { decision: "APPROVE" });
  await post("ticket-templates", admin, { key: "fixture", expectedVersion: 0, title: "测试模板",
    fields: [
      { key: "material", label: "素材", kind: "MATERIAL_PACKAGE", phase: "DISPATCH", required: true },
      { key: "response", label: "回传", kind: "TEXT", phase: "RESPONSE", required: true, maxLength: 80 },
    ],
  });
  statusReport++;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "fixture-nonce";
  const xml = Buffer.from(`<xml><ToUserName>${corp}</ToUserName><FromUserName>fixture_worker</FromUserName><CreateTime>${timestamp}</CreateTime><MsgType>text</MsgType><Content>synthetic inbound</Content><MsgId>900010000003</MsgId></xml>`);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(xml.length);
  const plain = Buffer.concat([Buffer.alloc(16, 42), len, xml, Buffer.from(corp)]);
  const padding = 32 - plain.length % 32;
  const cipher = createCipheriv("aes-256-cbc", aes, aes.subarray(0, 16)).setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
  const signature = createHash("sha1").update([cbToken, timestamp, nonce, encrypted].sort().join("")).digest("hex");
  const cb = "wecom/callback?" + new URLSearchParams({ timestamp, nonce, msg_signature: signature });
  for (const _ of [0, 1]) {
    assert.equal(await api(cb, { method: "POST", headers: { "Content-Type": "text/xml" }, body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`, output: "text" }), "success");
  }
  const [conversation] = await api("wecom/inbox/conversations", { token: admin });
  const messages = await api(`wecom/inbox/conversations/${conversation.id}/messages`, { token: admin });
  assert.equal(messages.length, 1);
  const input = {
    title: "隔离工单", description: "测试纯 Next.js 工单链路", assigneeId: worker.id,
    sourceMessageId: messages[0].id, templateKey: "fixture", templateVersion: 1,
    deadline: new Date(Date.now() + 86_400_000).toISOString(), fieldValues: { material: material.id },
  };
  const ticketPath = `wecom/inbox/conversations/${conversation.id}/tickets`;
  await post(ticketPath, admin, { ...input, priority: "invalid" }, 400);
  assert.equal((await api("tasks", { token: admin })).length, 0);
  const ticket = await post(ticketPath, admin, input);
  assert.deepEqual(await api(`attachments/${file.id}`, { token: workerToken, output: "bytes" }), png);
  await post(`tasks/${ticket.id}/submissions`, workerToken, { payload: { notes: "完成", fieldValues: { response: "已处理" } } });
  assert.equal((await post(`tasks/${ticket.id}/review`, admin, { decision: "APPROVE" })).status, "COMPLETED");
  statusReport++;

  const privateFile = await upload("PRIVATE_MESSAGE", workerToken);
  await pg.query("UPDATE attachments SET retention_until=now()-interval '1 second' WHERE id=$1", [privateFile.id]);
  await pg.query("UPDATE wecom_messages SET message_at=now()-interval '100 days'");
  const runCron = expected => call("/api/internal/scheduler", { method: "POST", token: cron, expected });
  await call("/api/internal/scheduler", { method: "POST", expected: 401 });
  await pg.query("INSERT INTO socialtask_job_leases VALUES('ops',gen_random_uuid(),now()+interval '5 minutes')");
  assert.equal((await runCron()).reason, "ALREADY_RUNNING");
  await pg.query("UPDATE socialtask_job_leases SET expires_at=now()-interval '1 second'");
  await api(`attachments/${privateFile.id}`, { token: admin, expected: 410 });
  brokenStorage = true;
  assert.deepEqual((await runCron(502)).failed, ["attachments"]);
  assert.equal((await pg.query("SELECT purged_at FROM attachments WHERE id=$1", [privateFile.id])).rows[0].purged_at, null);
  brokenStorage = false;
  const job = await runCron();
  assert.equal(job.attachments.purged, 1);
  assert.equal((await runCron()).attachments.purged, 0);
  await api(`attachments/${privateFile.id}`, { token: admin, expected: 410 });
  assert.equal(objects.size, 1);
  const [{ delivery_status, content }] = (await pg.query("SELECT delivery_status,content FROM wecom_messages")).rows;
  assert.equal(delivery_status, "REDACTED");
  assert.equal(content, null);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='RETENTION_PURGE'")).rows[0].n, 1);
  statusReport++;
  const retryKey = "ee92bd15-2e9f-4592-9eac-d1d84c645422";
  const lostKey = "6b9a4073-06b3-4fee-8a33-396c41f04b70";
  const abandonedKey = "b21b4ed6-b71d-4cdd-966d-e16905675761";
  const beforeObjects = objects.size;
  failFinish = "before";
  await upload("CONTENT", admin, { key: retryKey, expected: 502 });
  const first = await upload("CONTENT", admin, { key: retryKey });
  const replay = await upload("CONTENT", admin, { key: retryKey });
  assert.deepEqual(first, replay);
  await upload("CONTENT", admin, { key: retryKey, name: "another.png", expected: 409 });
  const scoped = await upload("PRIVATE_MESSAGE", workerToken, { key: retryKey });
  assert.notEqual(scoped.id, first.id);
  await api(`attachments/${scoped.id}`, { token: workerToken, expected: 403 });
  failFinish = "after";
  await upload("CONTENT", admin, { key: lostKey, expected: 502 });
  const committed = await upload("CONTENT", admin, { key: lostKey });
  assert.deepEqual(await api(`attachments/${committed.id}`, { token: admin, output: "bytes" }), png);
  const auditCount = await pg.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='UPLOAD' AND entity_id=$1", [String(committed.id)]);
  assert.equal(auditCount.rows[0].n, 1);
  failFinish = "before";
  await upload("CONTENT", admin, { key: abandonedKey, expected: 502 });
  assert.equal(objects.size, beforeObjects + 4);
  await pg.query("UPDATE socialtask_attachment_uploads SET expires_at=now()-interval '1 second' WHERE request_id=$1", [abandonedKey]);
  assert.equal((await runCron()).attachments.abandoned, 1);
  assert.equal(objects.size, beforeObjects + 3);
  await upload("CONTENT", admin, { key: abandonedKey, expected: 409 });
  assert.equal((await runCron()).attachments.abandoned, 0);
  statusReport++;
  console.log(`PASS ${statusReport}/6 Next.js scenarios: schema permissions, bootstrap/readiness, Storage ACL and validation, callback→ticket→review, cron/retention, retry and abandoned upload cleanup.`);
} catch (e) {
  console.error(appLog, rpcErrors);
  throw e;
} finally {
  child?.kill();
  gateway?.closeAllConnections();
  gateway?.close();
  await pg.close();
}
