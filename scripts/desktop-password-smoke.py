#!/usr/bin/env python3
"""Exercise the real SocialTask Next.js login/BFF with a local synthetic upstream.

Build apps/web, then serve it on loopback :43100 with
API_INTERNAL_URL=http://127.0.0.1:48100 (the mock starts in this script).
Requires Python Playwright and Chromium; QA_CHROMIUM_PATH can select a local binary.
Never use a production app or real account for this check.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

USER = "mock-desktop-worker"
PASSWORD = "Synthetic-Test-Only-Password"
TOKEN = "synthetic-http-only-token"
USER_VIEW = {"username": USER, "role": "support"}
web = os.getenv("QA_WEB_URL", "http://127.0.0.1:43100")
host = urlsplit(web)
if host.scheme != "http" or host.hostname not in {"127.0.0.1", "localhost"} or host.username:
    raise SystemExit("This smoke uses an isolated loopback-only test site")
LOGIN_TITLE = "Synthetic ticket 42"

class SyntheticUpstream(BaseHTTPRequestHandler):
    log_message = lambda *args: None
    def reply(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path != "/api/v1/auth/login":
            return self.reply(404, {"error": "unknown fixture"})
        data = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if data != {"username": USER, "password": PASSWORD}:
            return self.reply(401, {"error": "账号或密码不正确"})
        self.reply(200, {"user": USER_VIEW, "access_token": TOKEN, "expires_in": 43200})

    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            return self.reply(401, {"error": "未登录"})
        if self.path == "/api/v1/me":
            return self.reply(200, USER_VIEW)
        if self.path == "/api/v1/tasks/42":
            return self.reply(200, {"id": 42, "task_no": "TEST-42", "title": LOGIN_TITLE,
                                    "status": "COMPLETED", "type": "SERVICE_TICKET", "assignee_name": USER})
        self.reply(404, {"error": "unknown fixture"})

def main():
    upstream = ThreadingHTTPServer(("127.0.0.1", int(os.getenv("QA_FIXTURE_PORT","48100"))), SyntheticUpstream)
    thread = Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    launch = {"headless": True}
    if os.getenv("QA_CHROMIUM_PATH"):
        launch.update(executable_path=os.environ["QA_CHROMIUM_PATH"],
                      args=["--no-sandbox", "--single-process", "--no-zygote", "--disable-gpu"])
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(**launch)
            ctx = browser.new_context()
            ctx.route("**/*", lambda route: route.continue_() if urlsplit(route.request.url).netloc == host.netloc else route.abort())
            page = ctx.new_page()
            page.goto(web + "/m/tasks/42")
            expect(page).to_have_url(web + "/login?next=%2Fm%2Ftasks%2F42")
            expect(page.get_by_text("默认使用 SocialTask 账号密码登录。", exact=False)).to_be_visible()
            user = page.get_by_placeholder("请输入账号")
            password = page.get_by_placeholder("请输入密码")
            expect(user).to_have_value("")
            expect(password).to_have_value("")
            expect(password).to_have_attribute("type", "password")
            user.fill(USER)
            password.fill("wrong-synthetic-password")
            submit = page.get_by_role("button", name="登录系统")
            submit.click()
            expect(page.get_by_text("账号或密码不正确")).to_be_visible()
            assert not ctx.cookies()
            password.fill(PASSWORD)
            with page.expect_response(lambda r: r.url == web + "/api/auth/login") as success:
                submit.click()
            assert success.value.ok and PASSWORD not in success.value.text() and TOKEN not in success.value.text()
            expect(page).to_have_url(web + "/m/tasks/42")
            expect(page.get_by_role("heading", name=LOGIN_TITLE)).to_be_visible()
            cookie = next(c for c in ctx.cookies() if c["name"] == "socialtask_session")
            assert cookie["httpOnly"] and cookie["sameSite"] == "Lax" and cookie["path"] == "/"
            assert TOKEN not in page.evaluate("document.cookie")
            browser.close()
            print("PASS empty-by-default password sign-in; wrong credential rejected; HttpOnly cookie; original H5 ticket restored")
    finally:
        upstream.shutdown()
        upstream.server_close()

if __name__ == "__main__":
    main()
