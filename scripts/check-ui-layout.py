#!/usr/bin/env python3
"""Chromium layout tests against actual TSX markup + CSS rendered with an offline adapter.
No authentication, effects, API requests or React event simulation. Requires Node, TypeScript and Playwright.
Run the existing browser-acceptance.py separately for the real application and business-flow checks.
"""
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.getenv('UI_EVIDENCE_DIR', str(ROOT / 'ui-layout-evidence')))
OUT.mkdir(parents=True, exist_ok=True)
checks = 0

def check(condition, label):
    global checks
    if not condition:
        raise AssertionError(label)
    checks += 1
    print('PASS:', label)

def fixture(scenario):
    return subprocess.check_output(['node', str(ROOT / 'scripts/ui-layout-fixture.cjs'), scenario], cwd=ROOT, text=True)

with sync_playwright() as p:
    options = {'headless': True}
    if os.getenv('UI_CHROMIUM_EXECUTABLE'):
        options['executable_path'] = os.environ['UI_CHROMIUM_EXECUTABLE']
    browser = p.chromium.launch(**options)
    html_cache = {name: fixture(name) for name in ['messages', 'messages-list', 'dashboard', 'mobile', 'login', 'modal', 'empty']}
    page = browser.new_page(device_scale_factor=1, reduced_motion='reduce')
    # Any HTTP request from the fixture is a regression; block it even if one is introduced.
    requests = []
    page.route('**/*', lambda route: (requests.append(route.request.url), route.abort()))
    def show(name, width, height):
        page.set_viewport_size({'width': width, 'height': height})
        page.set_content(html_cache[name], wait_until='load')
        page.evaluate('document.fonts.ready')
        # Mirror the production chat's scroll-to-latest effect for screenshot framing only.
        page.evaluate("document.querySelectorAll('.inbox-stream').forEach(e=>e.scrollTop=e.scrollHeight)")
        overflow = page.evaluate('document.documentElement.scrollWidth - innerWidth')
        check(overflow <= 1, f'{name} {width}px no page-wide horizontal overflow ({overflow}px)')
    def screenshot(name):
        page.screenshot(path=str(OUT / f'{name}.png'), animations='disabled')
    for w, h in [(1536,960),(1366,900),(1024,900),(768,1024)]:
        show('messages',w,h)
        cols = page.locator('.inbox-grid').evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length')
        check(cols == (3 if w > 1180 else 2), f'{w}px expected inbox column count')
        check(page.locator('.inbox-conversation').is_visible(), f'{w}px conversation visible')
        check(page.locator('.inbox-context').is_visible(), f'{w}px member rail visible')
        check(page.locator('.related-ticket').count() == 1, f'{w}px related-ticket fixture renders')
        if w > 1180:
            check(page.get_by_role('button',name='发送应用消息').bounding_box()['y'] + page.get_by_role('button',name='发送应用消息').bounding_box()['height'] <= h, f'{w}px composer within viewport')
        if w == 1536: screenshot('messages-desktop')
        if w == 768: screenshot('messages-tablet')
    show('messages',1536,960)
    page.locator('.app-shell').evaluate('e=>e.classList.add("sidebar-collapsed")')
    page.wait_for_function("Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - 68) < 1", timeout=2000)
    check(abs(page.locator('.sidebar').bounding_box()['width'] - 68) < 1, 'collapsed desktop navigation width')
    check(page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'), 'collapsed layout does not overflow')
    show('messages',390,844)
    check(not page.locator('.inbox-list').is_visible() and page.locator('.inbox-conversation').is_visible(), 'mobile selected conversation hides list')
    check(page.locator('.inbox-back').is_visible(), 'mobile back control visible')
    check(page.get_by_role('button',name='发送应用消息').bounding_box()['y'] + page.get_by_role('button',name='发送应用消息').bounding_box()['height'] <= 844, '390px mobile composer within viewport')
    screenshot('messages-mobile-thread')
    show('messages-list',390,844)
    check(page.locator('.inbox-list').is_visible() and not page.locator('.inbox-conversation').is_visible(), 'mobile conversation list state')
    page.locator('.sidebar').evaluate('e=>e.classList.add("open")')
    page.locator('.sidebar').wait_for(state='visible', timeout=2000)
    check(page.locator('.sidebar').is_visible(), 'mobile navigation open CSS state')
    page.locator('.sidebar').evaluate('e=>e.classList.remove("open")')
    page.locator('.sidebar').wait_for(state='hidden', timeout=2000)
    screenshot('messages-mobile-list')
    show('messages',320,760)
    check(page.locator('.inbox-back').is_visible(), '320px conversation back control')
    show('empty',1536,960)
    check(page.get_by_text('选择一个成员会话').is_visible(), 'no selection empty state')
    check(page.get_by_role('button',name='创建工单',exact=True).is_disabled(), 'no selection cannot create ticket')
    show('modal',1366,900)
    check(page.get_by_role('dialog').is_visible(), 'ticket modal visible')
    check(page.get_by_label('标题').count() == 1, 'field label is associated with input')
    check(page.get_by_label('工单模板').count() == 1, 'ticket template selector is labeled')
    page.get_by_label('标题').focus()
    check(page.get_by_label('标题').evaluate('e=>getComputedStyle(e).outlineStyle') == 'solid', 'visible keyboard focus')
    screenshot('ticket-modal')
    for w,h in [(1536,960),(1024,900),(390,844),(320,760)]:
        show('dashboard',w,h)
        check(page.locator('.kpi-card').count() == 4, f'dashboard {w}px actual metric count')
        if w==1536: screenshot('dashboard-desktop')
    for w,h in [(1440,900),(390,844),(320,760)]:
        show('login',w,h)
        check(page.get_by_role('button',name='登录系统').is_visible(), f'login {w}px submit accessible')
        check(page.get_by_placeholder('请输入密码').get_attribute('type') == 'password', 'password field type retained')
        if w==1440: screenshot('login-desktop')
        if w==390: screenshot('login-mobile')
    for w,h in [(390,844),(320,760)]:
        show('mobile',w,h)
        check(page.locator('.mobile-stat').count() == 3, 'mobile task state summary')
        check(page.locator('.mobile-task').count() == 3, 'fixture tasks render')
        check(page.locator('.mobile-bottom').bounding_box()['y']+page.locator('.mobile-bottom').bounding_box()['height'] <= h+1, 'mobile bottom nav fits viewport')
        if w==390: screenshot('mobile-task-list')
    check(not requests, 'no external requests made')
    browser.close()
print(f'PASS: {checks} offline layout assertions. Not a full application build or browser acceptance test.')
