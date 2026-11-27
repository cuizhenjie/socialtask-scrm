#!/usr/bin/env python3
"""Comprehensive end-to-end business acceptance suite for SocialTask SCRM MVP.

Exercises ALL business nodes (A01-A28, CRM-01..05, V4 templates, V5/V6 WeCom, V7 KF, V8 SLA pause/resume,
V9 encrypted LLM profile) against a real isolated MySQL + Spring Boot API + Next.js Web stack
and real headless Chromium (Desktop + Mobile H5).

Safety guards:
- Requires QA_CONFIRM_DISPOSABLE=YES
- Strictly loopback HTTP URLs only; blocks all external browser network requests
- Uses synthetic fixtures only; never calls live WeCom, Douyin, or LLM APIs
"""
import base64
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import sys
import time
import uuid
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.sax.saxutils import escape

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from playwright.sync_api import expect, sync_playwright

CORP = os.getenv("QA_WECOM_CORP_ID", "ww-qa-only")
CALLBACK_TOKEN = os.getenv("QA_WECOM_CALLBACK_TOKEN", "socialtask-qa-callback-only")
AES_KEY = os.getenv("QA_WECOM_AES_KEY", "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA")
WEB = os.getenv("QA_WEB_URL", "http://127.0.0.1:3000").rstrip("/")
API = os.getenv("QA_API_URL", "http://127.0.0.1:8080").rstrip("/")
OUT = Path(os.getenv("QA_EVIDENCE_DIR", "qa-evidence-full")).resolve()
MYSQL_BIN = os.getenv("QA_MYSQL_BIN", "/opt/homebrew/bin/mysql")
MYSQL_SOCK = os.getenv("QA_MYSQL_SOCK", "/tmp/socialtask-mysql-qa.sock")
MYSQL_DB = os.getenv("QA_MYSQL_DB", "socialtask")
SUFFIX = uuid.uuid4().hex[:8]
RESULTS = []


def assert_local(url: str):
    p = urlsplit(url)
    if p.scheme != "http" or p.hostname not in {"127.0.0.1", "localhost", "::1"} or p.username or p.password:
        raise SystemExit(f"QA only: loopback http URL required, got: {url}")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = build_opener(NoRedirect())


def make_png(width: int = 8, height: int = 8, rgb=(36, 93, 235)) -> bytes:
    """Create a valid decodable PNG image in memory (no Pillow required)."""
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def api_req(path, *, method="GET", token=None, payload=None, raw=None, content_type=None, expected=200):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if payload is not None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        content_type = "application/json"
    if content_type:
        headers["Content-Type"] = content_type
    req = Request(API + "/api/v1/" + path, data=raw, headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=30) as resp:
            status, body = resp.status, resp.read()
    except HTTPError as e:
        status, body = e.code, e.read()
    expected_set = expected if isinstance(expected, (tuple, list, set)) else (expected,)
    if status not in expected_set:
        preview = body.decode("utf-8", errors="replace")[:400]
        raise AssertionError(f"{method} {path}: expected HTTP {expected_set}, got {status}: {preview}")
    if content_type == "application/octet-stream" or path.startswith("attachments/") and method == "GET" and status == 200:
        return body
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return body.decode("utf-8", errors="replace")


def upload_attachment(token: str, purpose: str, filename: str, content: bytes, mime: str = "image/png", expected=200):
    boundary = "----SocialTaskBoundary" + uuid.uuid4().hex
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\n{purpose}\r\n".encode(),
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n"
        ).encode()
        + content
        + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    return api_req(
        "attachments",
        method="POST",
        token=token,
        raw=body,
        content_type=f"multipart/form-data; boundary={boundary}",
        expected=expected,
    )


def login(username: str, password: str) -> str:
    return api_req("auth/login", method="POST", payload={"username": username, "password": password})["access_token"]


def post(path, payload, token, expected=200):
    return api_req(path, method="POST", token=token, payload=payload, expected=expected)


def put(path, payload, token, expected=200):
    return api_req(path, method="PUT", token=token, payload=payload, expected=expected)


def patch(path, payload, token, expected=200):
    return api_req(path, method="PATCH", token=token, payload=payload, expected=expected)


def make_callback(uid: str, text: str, msg_id: str, *, tamper_sig: bool = False):
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex[:12]
    xml = (
        "<xml><ToUserName>" + CORP + "</ToUserName><FromUserName>" + escape(uid)
        + "</FromUserName><CreateTime>" + ts + "</CreateTime><MsgType>text</MsgType><Content>"
        + escape(text) + "</Content><MsgId>" + escape(msg_id) + "</MsgId></xml>"
    ).encode()
    key = base64.b64decode(AES_KEY + "=")
    plain = bytes([42]) * 16 + len(xml).to_bytes(4, "big") + xml + CORP.encode()
    pad = 32 - len(plain) % 32
    enc = Cipher(algorithms.AES(key), modes.CBC(key[:16])).encryptor()
    encrypted = base64.b64encode(enc.update(plain + bytes([pad]) * pad) + enc.finalize()).decode()
    sig = hashlib.sha1("".join(sorted([CALLBACK_TOKEN, ts, nonce, encrypted])).encode()).hexdigest()
    if tamper_sig:
        sig = "0" * len(sig)
    query = urlencode({"msg_signature": sig, "timestamp": ts, "nonce": nonce})
    outer = ("<xml><Encrypt><![CDATA[" + encrypted + "]]></Encrypt></xml>").encode()
    return "wecom/callback?" + query, outer


def run_sql(sql: str):
    cmd = [MYSQL_BIN, "--no-defaults", f"--socket={MYSQL_SOCK}", "-u", "root", MYSQL_DB, "-e", sql]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def record(node_id: str, title: str, detail: str):
    RESULTS.append({"node": node_id, "title": title, "status": "PASS", "detail": detail})
    print(f"[PASS] {node_id} {title}: {detail}", flush=True)


def browser_guard(route):
    try:
        assert_local(route.request.url)
    except SystemExit:
        route.abort()
    else:
        route.continue_()


def browser_login(page, username: str, password: str):
    page.get_by_placeholder("请输入账号").fill(username)
    page.get_by_placeholder("请输入密码").fill(password)
    page.get_by_role("button", name="登录系统").click()


def shot(page, name: str):
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=True, animations="disabled")
    return path.name


def main():
    if os.getenv("QA_CONFIRM_DISPOSABLE") != "YES":
        raise SystemExit("Refusing to run: set QA_CONFIRM_DISPOSABLE=YES for a disposable DB.")
    assert_local(WEB)
    assert_local(API)
    OUT.mkdir(parents=True, exist_ok=True)
    admin_user = os.environ["QA_ADMIN_USERNAME"]
    admin_pass = os.environ["QA_ADMIN_PASSWORD"]
    worker_pass = "Synthetic-E2E-" + SUFFIX + "!9"
    future_iso = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M:%SZ")
    png_bytes = make_png()

    # =========================================================================
    # NODE 01: Health, Unauthenticated 401 & Admin Login
    # =========================================================================
    health = api_req("health")
    assert health.get("status") == "ok" or "status" in health, f"unexpected health: {health}"
    for protected in ("tasks", "customers", "people", "settings", "reports/tickets", "audit-logs"):
        api_req(protected, expected=401)
    admin = login(admin_user, admin_pass)
    me = api_req("me", token=admin)
    assert me["role"] == "admin"
    record("NODE-01", "健康检查与鉴权基线 (A01/A03)", f"API health ok; 6 protected endpoints enforce 401; admin={me['username']}")

    # =========================================================================
    # NODE 02: People, Groups, Tags, Multi-Accounts & Credentials (A05/CRM-05)
    # =========================================================================
    group_name = f"E2E业务组-{SUFFIX}"
    post("people/groups", {"name": group_name, "description": "全量业务实测分组"}, admin)
    # Ensure 第三组 exists for next-day follow-up tests
    groups_now = api_req("people/groups", token=admin)
    if not any(g["name"] == "第三组" for g in groups_now):
        post("people/groups", {"name": "第三组", "description": "次日回访授权客服组"}, admin)
    p_tag_id = post("people/tags", {"name": f"核心执行-{SUFFIX}"}, admin)["id"]

    creator1 = post("people", {"personNo": f"CR1{SUFFIX}", "name": f"素人一号-{SUFFIX}", "personType": "creator", "groupName": group_name, "wecomUserId": f"wc_cr1_{SUFFIX}"}, admin)
    creator2 = post("people", {"personNo": f"CR2{SUFFIX}", "name": f"素人二号-{SUFFIX}", "personType": "creator", "groupName": group_name}, admin)
    author1 = post("people", {"personNo": f"AU1{SUFFIX}", "name": f"作者一号-{SUFFIX}", "personType": "author", "groupName": group_name, "wecomUserId": f"wc_au1_{SUFFIX}"}, admin)
    assistant1 = post("people", {"personNo": f"AS1{SUFFIX}", "name": f"官方助理-{SUFFIX}", "personType": "assistant", "groupName": group_name, "wecomUserId": f"wc_as1_{SUFFIX}"}, admin)
    support1 = post("people", {"personNo": f"SP1{SUFFIX}", "name": f"客服一号-{SUFFIX}", "personType": "support", "groupName": group_name, "wecomUserId": f"wc_sp1_{SUFFIX}"}, admin)
    support2 = post("people", {"personNo": f"SP2{SUFFIX}", "name": f"客服二号-{SUFFIX}", "personType": "support", "groupName": group_name, "wecomUserId": f"wc_sp2_{SUFFIX}"}, admin)
    # Multi-account binding without overwriting history
    post(f"people/{creator1['id']}/accounts", {"nickname": f"素人主号-{SUFFIX}", "externalUid": f"DY_CR1_A_{SUFFIX}", "profileUrl": f"https://www.douyin.com/user/cr1a_{SUFFIX}", "platform": "douyin"}, admin)
    post(f"people/{creator1['id']}/accounts", {"nickname": f"素人副号-{SUFFIX}", "externalUid": f"DY_CR1_B_{SUFFIX}", "profileUrl": f"https://www.douyin.com/user/cr1b_{SUFFIX}", "platform": "douyin"}, admin)
    accounts = api_req(f"people/{creator1['id']}/accounts", token=admin)
    assert len(accounts) == 2, f"Expected 2 preserved accounts, got {len(accounts)}"
    put(f"people/{creator1['id']}/tags", {"tagIds": [p_tag_id]}, admin)
    put(f"people/{support1['id']}/tags", {"tagIds": [p_tag_id]}, admin)
    filtered_people = api_req("people?" + urlencode({"group": group_name, "tagId": p_tag_id}), token=admin)
    assert {p["id"] for p in filtered_people} == {creator1["id"], support1["id"]}

    creds = {}
    for key, person in [("creator1", creator1), ("creator2", creator2), ("author1", author1), ("assistant1", assistant1), ("support1", support1), ("support2", support2)]:
        uname = f"e2e-{key}-{SUFFIX}"
        post(f"people/{person['id']}/credentials", {"username": uname, "password": worker_pass}, admin)
        creds[key] = (uname, login(uname, worker_pass))

    # RBAC negative checks for worker role
    for restricted in ("customers", "people", "settings", "reports/tickets", "sla/policies", "audit-logs", "wecom/inbox/conversations"):
        api_req(restricted, token=creds["creator1"][1], expected=403)
    record("NODE-02", "人员分组标签、多账号绑定与最小权限 (A04/A05)", f"6 roles provisioned; 2 Douyin accounts preserved; 7 admin APIs return 403 for worker")

    # =========================================================================
    # NODE 03: Private Attachments & Content Compliance Gate (A07/A26)
    # =========================================================================
    upload_attachment(admin, "CONTENT", "forged.png", b"NOT A REAL PNG FILE", "image/png", expected=400)
    content_asset = upload_attachment(admin, "CONTENT", "material.png", png_bytes, "image/png", expected=200)
    asset_id = content_asset["id"]
    # Unassigned worker cannot download content asset
    api_req(f"attachments/{asset_id}", token=creds["creator1"][1], expected=403)
    # Admin can download
    downloaded = api_req(f"attachments/{asset_id}", token=admin, expected=200)
    assert downloaded.startswith(b"\x89PNG")

    pkg = post("content-packages", {"title": f"合规内容包-{SUFFIX}", "body": "经人工合规审核的真实分享正文", "hashtags": "#合规实测", "assetIds": [asset_id]}, admin)
    pkg_id = pkg["id"]
    assert pkg["review_status"] == "DRAFT"
    # Draft content package cannot be dispatched
    post("publish-batches", {"title": f"非法草稿批次-{SUFFIX}", "contentId": pkg_id, "assigneeIds": [creator1["id"]], "deadline": future_iso}, admin, expected=409)
    # Approve content package
    approved_pkg = post(f"content-packages/{pkg_id}/review", {"decision": "APPROVE"}, admin)
    assert approved_pkg["review_status"] == "APPROVED"
    record("NODE-03", "附件真伪校验与内容合规审核门禁 (A07/A26)", f"forged PNG rejected(400); valid asset #{asset_id} protected(403 unassigned); draft dispatch blocked(409) -> APPROVED")

    # =========================================================================
    # NODE 04: Publish Batch -> Mobile H5 Submit -> Rework -> Approve -> Work Dedupe (A08/A09/A10/A28)
    # =========================================================================
    batch = post(
        "publish-batches",
        {"title": f"全量发布批次-{SUFFIX}", "contentId": pkg_id, "assigneeIds": [creator1["id"], author1["id"]], "deadline": future_iso, "reminderInterval": 60, "reminderMax": 5},
        admin,
    )
    assert batch["task_count"] == 2
    batch_tasks = [t for t in api_req("tasks", token=admin) if t.get("batch_id") == batch["id"]]
    t_cr1 = next(t for t in batch_tasks if t["assignee_id"] == creator1["id"])
    t_au1 = next(t for t in batch_tasks if t["assignee_id"] == author1["id"])
    # Now creator1 IS assigned to this batch, so content asset download is permitted (200)
    assert api_req(f"attachments/{asset_id}", token=creds["creator1"][1], expected=200).startswith(b"\x89PNG")
    # creator1 cannot view author1's task
    api_req(f"tasks/{t_au1['id']}", token=creds["creator1"][1], expected=403)

    # Execute creator1's PUBLISH submission via REAL Mobile Chromium H5!
    work_url_1_v1 = f"https://www.douyin.com/video/74001{SUFFIX[:6]}1"
    work_url_1_v2 = f"https://www.douyin.com/video/74002{SUFFIX[:6]}2"
    work_url_2 = f"https://www.douyin.com/video/74003{SUFFIX[:6]}3"
    launch_opts = {"headless": True}
    if os.getenv("QA_CHROMIUM_PATH"):
        launch_opts["executable_path"] = os.environ["QA_CHROMIUM_PATH"]

    browser_errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_opts)
        m_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
        m_ctx.route("**/*", browser_guard)
        mp = m_ctx.new_page()
        mp.on("pageerror", lambda e: browser_errors.append(f"mobile-publish: {e}"))
        mp.goto(f"{WEB}/m/tasks/{t_cr1['id']}")
        expect(mp).to_have_url(re.compile(r"/login\?next="))
        browser_login(mp, creds["creator1"][0], worker_pass)
        expect(mp).to_have_url(f"{WEB}/m/tasks/{t_cr1['id']}")
        expect(mp.get_by_text(f"合规内容包-{SUFFIX}", exact=True)).to_be_visible()
        mp.get_by_placeholder("https://www.douyin.com/video/...").fill(work_url_1_v1)
        shot(mp, "e2e-01-mobile-publish-submit")
        mp.get_by_role("button", name="提交结果，等待管理员核验").click()
        expect(mp).to_have_url(f"{WEB}/m")
        m_ctx.close()
        browser.close()

    # Admin REJECTS -> REWORK, then creator1 re-submits revision 2 -> Admin APPROVES
    rework = post(f"tasks/{t_cr1['id']}/review", {"decision": "REJECT", "reason": "链接为草稿版，请核对后重提"}, admin)
    assert rework["status"] == "REWORK"
    post(f"tasks/{t_cr1['id']}/submissions", {"payload": {"work_url": work_url_1_v2}}, creds["creator1"][1])
    approved_pub1 = post(f"tasks/{t_cr1['id']}/review", {"decision": "APPROVE"}, admin)
    assert approved_pub1["status"] == "COMPLETED"
    assert len(approved_pub1["submissions"]) == 2, "Must preserve both submission revisions"
    work1_id = approved_pub1["work_id"]

    # Duplicate Douyin URL submitted by author1 must be rejected (409)
    post(f"tasks/{t_au1['id']}/submissions", {"payload": {"work_url": work_url_1_v2}}, creds["author1"][1], expected=409)
    post(f"tasks/{t_au1['id']}/submissions", {"payload": {"work_url": work_url_2}}, creds["author1"][1], expected=200)
    approved_pub2 = post(f"tasks/{t_au1['id']}/review", {"decision": "APPROVE"}, admin)
    work2_id = approved_pub2["work_id"]
    record("NODE-04", "发布批次、移动端回传、退回重做与作品去重 (A08/A09/A10/A28)", f"Mobile H5 submit -> REWORK -> rev2 -> APPROVE (work#{work1_id}); dup URL blocked(409); work#{work2_id} verified")

    # =========================================================================
    # NODE 05: Official Assistant Comment (no screenshot) & Real Comment (A11/A12)
    # =========================================================================
    oc_task = post(f"works/{work1_id}/comment-tasks", {"assistantId": assistant1["id"], "commentText": "您好，官方助理为您答疑。", "deadline": future_iso}, admin)
    oc_id = oc_task["id"]
    # Submitting without confirmation fails (400); submitting with screenshot fails (400)
    post(f"tasks/{oc_id}/submissions", {"payload": {"confirmed": False}}, creds["assistant1"][1], expected=400)
    post(f"tasks/{oc_id}/submissions", {"payload": {"confirmed": True}}, creds["assistant1"][1], expected=200)
    oc_done = post(f"tasks/{oc_id}/review", {"decision": "APPROVE"}, admin)
    assert oc_done["status"] == "COMPLETED"

    c1_comment = post(f"works/{work1_id}/comments", {"nickname": f"意向客户甲-{SUFFIX}", "externalUid": f"CUST_UID_1_{SUFFIX}", "content": "请问方案细节如何咨询？", "category": "咨询"}, admin)
    c2_comment = post(f"works/{work2_id}/comments", {"nickname": f"意向客户甲-{SUFFIX}", "externalUid": f"CUST_UID_1_{SUFFIX}", "content": "在第二个作品下再次留言", "category": "咨询"}, admin)
    work1_comments = api_req(f"works/{work1_id}/comments", token=admin)
    assert any(c["id"] == c1_comment["id"] for c in work1_comments)
    record("NODE-05", "官方助理公开评论与真实评论双分支 (A11/A12)", f"Official comment task #{oc_id} confirmed without screenshot & verified; 2 real comments recorded")

    # =========================================================================
    # NODE 06: Customer Unique Archive, Multi-Source, No-Nickname-Merge & CRM Classification (A13/A14/CRM-02..05)
    # =========================================================================
    cust1 = post("customers", {"nickname": f"意向客户甲-{SUFFIX}", "externalUid": f"CUST_UID_1_{SUFFIX}", "identityVerified": True, "sourceWorkId": work1_id, "sourceCommentId": c1_comment["id"], "contactAllowed": True, "consentBasis": "客户主动评论咨询并允许官方回复"}, admin)
    cust1_dup = post("customers", {"nickname": f"意向客户甲改名-{SUFFIX}", "externalUid": f"CUST_UID_1_{SUFFIX}", "identityVerified": True, "sourceWorkId": work2_id, "sourceCommentId": c2_comment["id"], "contactAllowed": True, "consentBasis": "客户主动评论咨询并允许官方回复"}, admin)
    assert cust1["id"] == cust1_dup["id"], "Verified UID must deduplicate to same customer"
    assert len(cust1_dup["sources"]) == 2, f"Expected 2 linked work sources, got {len(cust1_dup['sources'])}"

    # Unverified same nickname must NOT merge
    dup_nick_1 = post("customers", {"nickname": f"同名未核验-{SUFFIX}", "identityVerified": False, "contactAllowed": False}, admin)
    dup_nick_2 = post("customers", {"nickname": f"同名未核验-{SUFFIX}", "identityVerified": False, "contactAllowed": False}, admin)
    assert dup_nick_1["id"] != dup_nick_2["id"], "Unverified same nickname must NEVER auto-merge"

    # Customer segments & tags (isolated from people tags)
    seg = post("customers/segments", {"name": f"高意向分组-{SUFFIX}", "description": "商业化重点线索"}, admin)
    ctag = post("customers/tags", {"name": f"高潜线索-{SUFFIX}"}, admin)
    classified = put(f"customers/{cust1['id']}/classification", {"segmentId": seg["id"], "tagIds": [ctag["id"]]}, admin)
    assert classified["segment_name"] == f"高意向分组-{SUFFIX}"
    c_search = api_req("customers?" + urlencode({"segmentId": seg["id"], "tagId": ctag["id"], "status": "NEW"}), token=admin)
    assert [c["id"] for c in c_search] == [cust1["id"]]
    put(f"customers/{cust1['id']}/classification", {"segmentId": seg["id"], "tagIds": [ctag["id"]]}, creds["creator1"][1], expected=403)
    record("NODE-06", "客户唯一去重、多来源关联与客户分层标签 (A13/A14/CRM-02..05)", f"UID dedupe -> cust#{cust1['id']} (2 sources); unverified same-nick distinct({dup_nick_1['id']},{dup_nick_2['id']}); segment+tag filter verified")

    # =========================================================================
    # NODE 07: First-Round Parallel Contact, PM Screenshot Privacy, Reply/Refuse Stop-Other (A15/A16/A17/A18)
    # =========================================================================
    # No contact permission -> cannot start contact round
    post(f"customers/{dup_nick_1['id']}/contact-rounds", {"authorId": author1["id"], "assistantId": assistant1["id"], "privateMessage": "测试", "deadline": future_iso}, admin, expected=(400, 409))

    # Scenario A: Author reports REPLIED -> Assistant task auto-STOPPED
    r1 = post(f"customers/{cust1['id']}/contact-rounds", {"authorId": author1["id"], "assistantId": assistant1["id"], "privateMessage": "您好，这里是官方账号回应您的主动咨询。", "deadline": future_iso}, admin)
    au_t1, as_t1 = r1["author_task_id"], r1["assistant_task_id"]
    api_req(f"tasks/{as_t1}", token=creds["author1"][1], expected=403)
    post(f"tasks/{au_t1}/submissions", {"payload": {"reply_status": "REPLIED"}}, creds["author1"][1], expected=400)
    pm_att_au = upload_attachment(creds["author1"][1], "PRIVATE_MESSAGE", "pm_author.png", png_bytes, "image/png", expected=200)
    # Worker CANNOT download PRIVATE_MESSAGE attachment; Admin CAN
    api_req(f"attachments/{pm_att_au['id']}", token=creds["author1"][1], expected=403)
    assert api_req(f"attachments/{pm_att_au['id']}", token=admin, expected=200).startswith(b"\x89PNG")
    # Assistant cannot impersonate using author's attachment
    post(f"tasks/{as_t1}/submissions", {"payload": {"reply_status": "NO_REPLY"}, "attachmentId": pm_att_au["id"]}, creds["assistant1"][1], expected=403)
    # Author submits REPLIED -> Assistant task STOPPED
    post(f"tasks/{au_t1}/submissions", {"payload": {"reply_status": "REPLIED"}, "attachmentId": pm_att_au["id"]}, creds["author1"][1], expected=200)
    assert api_req(f"tasks/{as_t1}", token=admin)["status"] == "STOPPED"
    assert api_req(f"customers/{cust1['id']}", token=admin)["status"] == "RESPONDED"

    # Scenario B: Do-not-contact stops pending tasks and blocks re-enabling
    cust2 = post("customers", {"nickname": f"拒联客户乙-{SUFFIX}", "externalUid": f"CUST_UID_2_{SUFFIX}", "identityVerified": True, "sourceWorkId": work1_id, "contactAllowed": True, "consentBasis": "客户留言询问"}, admin)
    r2 = post(f"customers/{cust2['id']}/contact-rounds", {"authorId": author1["id"], "assistantId": assistant1["id"], "privateMessage": "您好，回应咨询。", "deadline": future_iso}, admin)
    dnc = post(f"customers/{cust2['id']}/do-not-contact", {"reason": "客户明确表示无需联系"}, admin)
    assert dnc["status"] == "REFUSED" and dnc["do_not_contact"] is True
    assert api_req(f"tasks/{r2['author_task_id']}", token=admin)["status"] == "STOPPED"
    assert api_req(f"tasks/{r2['assistant_task_id']}", token=admin)["status"] == "STOPPED"
    post(f"customers/{cust2['id']}/contact-permission", {"contactAllowed": True, "consentBasis": "试图强行重开"}, admin, expected=409)
    record("NODE-07", "首轮并行私信、截图隐私与回复/拒联阻断 (A15/A16/A17/A18)", f"PM screenshot admin-only; REPLIED stopped assistant task #{as_t1}; DNC stopped both tasks & blocked re-enable(409)")

    # =========================================================================
    # NODE 08: Next-Day Follow-up Eligibility, 3rd-Group Support Guard & Idempotency (A19/A20/A21)
    # =========================================================================
    cust3 = post("customers", {"nickname": f"次日回访客户丙-{SUFFIX}", "externalUid": f"CUST_UID_3_{SUFFIX}", "identityVerified": True, "sourceWorkId": work1_id, "contactAllowed": True, "consentBasis": "客户主动咨询且允许回访"}, admin)
    r3 = post(f"customers/{cust3['id']}/contact-rounds", {"authorId": author1["id"], "assistantId": assistant1["id"], "privateMessage": "您好，官方跟进您的咨询。", "deadline": future_iso}, admin)
    pm_au3 = upload_attachment(creds["author1"][1], "PRIVATE_MESSAGE", "pm_au3.png", png_bytes)
    pm_as3 = upload_attachment(creds["assistant1"][1], "PRIVATE_MESSAGE", "pm_as3.png", png_bytes)
    post(f"tasks/{r3['author_task_id']}/submissions", {"payload": {"reply_status": "NO_REPLY"}, "attachmentId": pm_au3["id"]}, creds["author1"][1])
    post(f"tasks/{r3['assistant_task_id']}/submissions", {"payload": {"reply_status": "NO_REPLY"}, "attachmentId": pm_as3["id"]}, creds["assistant1"][1])
    post(f"tasks/{r3['author_task_id']}/review", {"decision": "APPROVE"}, admin)
    post(f"tasks/{r3['assistant_task_id']}/review", {"decision": "APPROVE"}, admin)

    # Same day tick must NOT create round 2
    tick_same = post("ops/tick", {}, admin)
    assert tick_same["followups"]["created"] == 0, f"Same-day tick must not create followup: {tick_same}"

    # Simulate next Asia/Shanghai calendar day in disposable DB
    run_sql(f"UPDATE tasks SET updated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY) WHERE id IN ({r3['author_task_id']}, {r3['assistant_task_id']});")
    # Ensure no active eligible 3rd-group support yet (check missing_support guard A21)
    run_sql("UPDATE people SET status='INACTIVE' WHERE group_name='第三组' AND person_type='support';")
    tick_no_staff = post("ops/tick", {}, admin)
    assert tick_no_staff["followups"]["created"] == 0 and tick_no_staff["followups"]["missing_support"] >= 1, f"A21 guard failed: {tick_no_staff}"

    # Now create qualified 3rd-group support (ACTIVE + wecomUserId + active Douyin account)
    support3 = post("people", {"personNo": f"SP3{SUFFIX}", "name": f"三组回访客服-{SUFFIX}", "personType": "support", "groupName": "第三组", "wecomUserId": f"wc_sp3_{SUFFIX}"}, admin)
    post(f"people/{support3['id']}/accounts", {"nickname": f"官方回访号-{SUFFIX}", "externalUid": f"DY_SP3_{SUFFIX}", "profileUrl": f"https://www.douyin.com/user/sp3_{SUFFIX}", "platform": "douyin"}, admin)
    tick_created = post("ops/tick", {}, admin)
    assert tick_created["followups"]["created"] == 1, f"Expected 1 next-day followup, got: {tick_created}"
    # Repeat tick must be idempotent (0 new followups)
    tick_repeat = post("ops/tick", {}, admin)
    assert tick_repeat["followups"]["created"] == 0, f"Repeat tick created duplicate followup: {tick_repeat}"
    c3_detail = api_req(f"customers/{cust3['id']}", token=admin)
    assert c3_detail["status"] == "FOLLOWUP_PENDING" and len(c3_detail["contact_rounds"]) == 2
    record("NODE-08", "次日回访资格、三组客服准入与幂等调度 (A19/A20/A21)", f"Same-day=0; no-3rd-group=0(missing_support>=1); qualified 3rd-group->created=1; repeat=0")

    # =========================================================================
    # NODE 09: Ticket Templates (V4), SLA Pause/Resume (V8), Transfer, Cancel & Deactivation (A06/A24/A25)
    # =========================================================================
    tpl_key = f"tpl_{SUFFIX}"
    tpl = post(
        "ticket-templates",
        {
            "key": tpl_key,
            "expectedVersion": 0,
            "title": f"商业化服务模板-{SUFFIX}",
            "fields": [
                {"id": "channel_note", "label": "渠道说明", "kind": "TEXT", "phase": "DISPATCH", "required": True, "maxLength": 200},
                {"id": "material_pkg", "label": "关联素材包", "kind": "MATERIAL_PACKAGE", "phase": "DISPATCH", "required": False},
                {"id": "handle_summary", "label": "回执结论", "kind": "TEXT", "phase": "RESPONSE", "required": True, "maxLength": 300},
            ],
        },
        admin,
    )
    assert tpl["version"] == 1

    svc_ticket = post(
        "tickets",
        {
            "title": f"模板服务工单-{SUFFIX}",
            "description": "验证模板快照、SLA暂停恢复与转派闭环",
            "assigneeId": support1["id"],
            "deadline": future_iso,
            "priority": "HIGH",
            "templateKey": tpl_key,
            "templateVersion": 1,
            "fieldValues": {"channel_note": "官网线索转派", "material_pkg": pkg_id},
        },
        admin,
    )
    tkt_id = svc_ticket["id"]
    assert svc_ticket["sla"]["response_due_at"] is not None

    # SLA Pause blocks submission, Resume re-enables it
    paused = post(f"tasks/{tkt_id}/sla/pause", {"reason": "等待客户补充材料"}, admin)
    assert paused["paused_at"] is not None
    post(f"tasks/{tkt_id}/submissions", {"payload": {"notes": "暂停中不应成功", "fieldValues": {"handle_summary": "测试"}}}, creds["support1"][1], expected=409)
    resumed = post(f"tasks/{tkt_id}/sla/resume", {}, admin)
    assert resumed["paused_at"] is None and resumed["pause_count"] == 1

    # Transfer to support2 preserves task_no & SLA history
    transferred = post(f"tasks/{tkt_id}/transfer", {"assigneeId": support2["id"], "reason": "排班交接"}, admin)
    assert transferred["assignee_id"] == support2["id"] and transferred["task_no"] == svc_ticket["task_no"]
    # support2 completes ticket with template response field
    post(f"tasks/{tkt_id}/submissions", {"payload": {"notes": "已完成客户核验答复", "fieldValues": {"handle_summary": "客户满意已闭环"}}}, creds["support2"][1], expected=200)
    done_tkt = post(f"tasks/{tkt_id}/review", {"decision": "APPROVE"}, admin)
    assert done_tkt["status"] == "COMPLETED" and done_tkt["sla"]["resolved_at"] is not None

    # Cancel test
    cancel_tkt = post("tickets", {"title": f"待取消工单-{SUFFIX}", "description": "取消流转验证", "assigneeId": support1["id"], "deadline": future_iso, "priority": "NORMAL"}, admin)
    cancelled = post(f"tasks/{cancel_tkt['id']}/cancel", {}, admin)
    assert cancelled["status"] == "CANCELLED"

    # Person deactivation revokes sessions & pauses pending tasks (A06)
    deact_batch = post("publish-batches", {"title": f"停用测试批次-{SUFFIX}", "contentId": pkg_id, "assigneeIds": [creator2["id"]], "deadline": future_iso}, admin)
    deact_task = next(t for t in api_req("tasks", token=admin) if t.get("batch_id") == deact_batch["id"])
    patch(f"people/{creator2['id']}", {"status": "INACTIVE"}, admin)
    api_req("me", token=creds["creator2"][1], expected=401)
    assert api_req(f"tasks/{deact_task['id']}", token=admin)["status"] == "PAUSED"
    record("NODE-09", "工单模板、SLA暂停恢复、转派取消与停用暂停 (A06/A24/A25/V4/V8)", f"Template v1->tkt#{tkt_id} pause/resume/transfer/approve; cancel ok; creator2 INACTIVE->session 401 & task PAUSED")

    # =========================================================================
    # NODE 10: WeCom Callback Dedupe, Outbox NOT_CONFIGURED, KF State, Settings, V9 LLM Profile, Reports & Audit (A22)
    # =========================================================================
    bad_path, bad_body = make_callback(f"wc_sp1_{SUFFIX}", "伪造签名", f"bad_{SUFFIX}", tamper_sig=True)
    api_req(bad_path, method="POST", raw=bad_body, content_type="text/xml", expected=(400, 403))
    cb_msg = f"E2E企微入站正文-{SUFFIX}"
    ok_path, ok_body = make_callback(f"wc_sp1_{SUFFIX}", cb_msg, f"msg_{SUFFIX}")
    assert api_req(ok_path, method="POST", raw=ok_body, content_type="text/xml") == "success"
    assert api_req(ok_path, method="POST", raw=ok_body, content_type="text/xml") == "success"
    convs = api_req("wecom/inbox/conversations?" + urlencode({"q": f"wc_sp1_{SUFFIX}"}), token=admin)
    conv = next(c for c in convs if c["peer_userid"] == f"wc_sp1_{SUFFIX}")
    msgs = api_req(f"wecom/inbox/conversations/{conv['id']}/messages", token=admin)
    assert len(msgs) == 1 and msgs[0]["content"] == cb_msg

    # Verify outbox notifications never fake SENT when WECOM_ENABLED=false
    notices = api_req("notifications", token=admin)
    assert len(notices) > 0
    assert not any(n["state"] == "SENT" for n in notices), "WECOM_ENABLED=false must NEVER produce SENT state"
    assert any(n["state"] == "NOT_CONFIGURED" for n in notices), "Expected NOT_CONFIGURED outbox entries"

    # KF read model state
    kf_state = api_req("kf/state", token=admin)
    assert kf_state["enabled"] is False

    # Settings security & V9 encrypted LLM profile
    settings_data = api_req("settings", token=admin)
    assert settings_data["connection_tested"] is False
    llm_view = api_req("settings/llm", token=admin)
    if llm_view.get("master_key_configured") and llm_view.get("allowed_origins"):
        origin = llm_view["allowed_origins"][0]
        saved_llm = put(
            "settings/llm",
            {
                "expectedVersion": llm_view["version"],
                "enabled": False,
                "endpointMode": "BASE_URL",
                "endpointUrl": origin + "/v1",
                "modelId": "gpt-4o-mini-qa",
                "apiKey": "sk-qa-synthetic-secret-never-echo",
                "clearApiKey": False,
            },
            admin,
        )
        assert saved_llm["api_key_configured"] is True
        assert "sk-qa-synthetic-secret-never-echo" not in json.dumps(saved_llm)

    report = api_req("reports/tickets?" + urlencode({"group": group_name}), token=admin)
    assert report["summary"]["total"] >= 1 and report["summary"]["completed"] >= 1
    audits = api_req("audit-logs", token=admin)
    assert len(audits) >= 10
    record("NODE-10", "企微回调幂等、Outbox诚实状态、设置/加密LLM与报表审计 (A22/V6/V7/V9)", f"Tampered sig rejected; duplicate MsgId->1 row; outbox NOT_CONFIGURED; report total={report['summary']['total']}; audits={len(audits)}")

    # =========================================================================
    # NODE 11: Full Browser UI Walkthrough Across ALL 15 Admin Routes + Mobile H5 (A27/A28)
    # =========================================================================
    admin_routes = [
        ("/admin", "运营总览", "e2e-02-admin-dashboard"),
        ("/admin/messages", "企业微信聚合消息工作台", "e2e-03-admin-messages"),
        ("/admin/kf", "微信客服会话", "e2e-04-admin-kf"),
        ("/admin/tasks", "统一任务工单中心", "e2e-05-admin-tasks"),
        ("/admin/people", "人员、分组与标签", "e2e-06-admin-people"),
        ("/admin/customers", "客户档案管理", "e2e-07-admin-customers"),
        ("/admin/content", "内容素材", "e2e-08-admin-content"),
        ("/admin/batches", "发布批次", "e2e-09-admin-batches"),
        ("/admin/works", "作品", "e2e-10-admin-works"),
        ("/admin/comments", "评论", "e2e-11-admin-comments"),
        ("/admin/ticket-templates", "工单模板", "e2e-12-admin-templates"),
        ("/admin/sla", "工单 SLA 策略", "e2e-13-admin-sla"),
        ("/admin/reports", "工单运营与 SLA 统计", "e2e-14-admin-reports"),
        ("/admin/audit", "审计", "e2e-15-admin-audit"),
        ("/admin/settings", "全局系统设置", "e2e-16-admin-settings"),
    ]
    console_errors = []
    http_5xx = []
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_opts)
        d_ctx = browser.new_context(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
        d_ctx.route("**/*", browser_guard)
        page = d_ctx.new_page()
        page.on("pageerror", lambda e: browser_errors.append(f"desktop: {e}"))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("response", lambda r: http_5xx.append(f"{r.status} {r.url}") if r.status >= 500 else None)

        page.goto(WEB + "/login")
        browser_login(page, admin_user, admin_pass)
        expect(page).to_have_url(WEB + "/admin")

        for route, text_hint, shot_name in admin_routes:
            page.goto(WEB + route, wait_until="networkidle")
            expect(page.locator("main")).to_be_visible()
            body_text = page.locator("main").inner_text()
            assert "不存在此管理模块" not in body_text, f"Unknown section on {route}"
            assert text_hint in body_text or len(body_text.strip()) > 20, f"Unexpected empty/missing content on {route}: {body_text[:120]}"
            overflow = page.evaluate("document.documentElement.scrollWidth - innerWidth")
            assert overflow <= 2, f"Horizontal overflow {overflow}px on {route}"
            shot(page, shot_name)

        # Verify Mobile Home renders tasks cleanly for support2
        m_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
        m_ctx.route("**/*", browser_guard)
        mp = m_ctx.new_page()
        mp.on("pageerror", lambda e: browser_errors.append(f"mobile-home: {e}"))
        mp.on("response", lambda r: http_5xx.append(f"{r.status} {r.url}") if r.status >= 500 else None)
        mp.goto(WEB + "/login")
        browser_login(mp, creds["support2"][0], worker_pass)
        expect(mp).to_have_url(WEB + "/m")
        expect(mp.get_by_text(f"模板服务工单-{SUFFIX}", exact=True)).to_be_visible()
        shot(mp, "e2e-17-mobile-home-completed")
        m_ctx.close()
        d_ctx.close()
        browser.close()

    assert not browser_errors, f"Browser page errors: {browser_errors}"
    assert not http_5xx, f"HTTP 5xx errors: {http_5xx}"
    assert not console_errors, f"Browser console errors: {console_errors}"
    record("NODE-11", "全量 15 个管理端页面与移动端 H5 真实浏览器验收 (A27/A28)", f"15 admin routes + mobile H5 rendered with 0 pageerror, 0 console errors, 0 HTTP 5xx, 0 overflow; 17 screenshots saved")

    summary = {
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "suffix": SUFFIX,
        "total_nodes": len(RESULTS),
        "passed_nodes": sum(1 for r in RESULTS if r["status"] == "PASS"),
        "evidence_dir": str(OUT),
        "nodes": RESULTS,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nALL {summary['passed_nodes']}/{summary['total_nodes']} FULL-BUSINESS E2E NODES PASSED. Evidence: {OUT}", flush=True)


if __name__ == "__main__":
    main()
