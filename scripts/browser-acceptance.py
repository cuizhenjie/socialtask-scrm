#!/usr/bin/env python3
"""Local-only v1.1 acceptance runner. Creates synthetic fixtures in a DISPOSABLE DB.
Requires Python 3.10+, playwright, cryptography, installed Chromium. No live WeCom requests.
Run only after applying the accompanying patch, starting the isolated Compose stack,
and setting the QA_* environment variables described in the acceptance report.
"""
import base64
import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from xml.sax.saxutils import escape
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from playwright.sync_api import sync_playwright, expect

CORP = 'ww-qa-only'
CALLBACK_TOKEN = 'socialtask-qa-callback-only'
AES_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA'
WEB = os.getenv('QA_WEB_URL', 'http://127.0.0.1:3000').rstrip('/')
API = WEB
OUT = Path(os.getenv('QA_EVIDENCE_DIR', 'qa-evidence-socialtask')).resolve()
SUFFIX = uuid.uuid4().hex[:8]


def assert_local(url):
    p = urlsplit(url)
    if p.scheme != 'http' or p.hostname not in {'127.0.0.1', 'localhost', '::1'} or p.username or p.password:
        raise SystemExit('QA only: loopback http URL required; no production or external URLs.')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = build_opener(NoRedirect())


def request(path, *, method='GET', token=None, payload=None, raw=None, content_type=None, expected=200):
    headers = {}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if payload is not None:
        raw = json.dumps(payload, ensure_ascii=False).encode()
        content_type = 'application/json'
    if content_type:
        headers['Content-Type'] = content_type
    req = Request(API + '/api/v1/' + path, data=raw, headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=30) as resp:
            status, body = resp.status, resp.read()
    except HTTPError as e:
        status, body = e.code, e.read()
    if status != expected:
        raise AssertionError(f'{method} {path.split("?")[0]}: expected HTTP {expected}; got {status}')
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return body.decode('utf-8', errors='replace')


def login(user, password):
    return request('auth/login', method='POST', payload={'username':user,'password':password})['access_token']


def post(path, payload, token):
    return request(path, method='POST', token=token, payload=payload)


def make_callback(uid, text, msg_id):
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex[:12]
    xml = ('<xml><ToUserName>' + CORP + '</ToUserName><FromUserName>' + escape(uid) +
           '</FromUserName><CreateTime>' + ts + '</CreateTime><MsgType>text</MsgType><Content>' +
           escape(text) + '</Content><MsgId>' + escape(msg_id) + '</MsgId></xml>').encode()
    key = base64.b64decode(AES_KEY + '=')
    plain = bytes([42])*16 + len(xml).to_bytes(4,'big') + xml + CORP.encode()
    pad = 32 - len(plain)%32
    enc = Cipher(algorithms.AES(key),modes.CBC(key[:16])).encryptor()
    encrypted = base64.b64encode(enc.update(plain+bytes([pad])*pad)+enc.finalize()).decode()
    sig = hashlib.sha1(''.join(sorted([CALLBACK_TOKEN,ts,nonce,encrypted])).encode()).hexdigest()
    query = urlencode({'msg_signature':sig,'timestamp':ts,'nonce':nonce})
    outer = ('<xml><Encrypt><![CDATA['+encrypted+']]></Encrypt></xml>').encode()
    return 'wecom/callback?'+query,outer


def login_browser(page, username, password):
    page.get_by_placeholder('请输入账号').fill(username)
    page.get_by_placeholder('请输入密码').fill(password)
    page.get_by_role('button',name='登录系统').click()


def shot(page, name):
    page.screenshot(path=str(OUT/(name+'.png')),full_page=True,animations='disabled')
    print('SCREENSHOT',name+'.png',flush=True)


def browser_guard(route):
    try:
        assert_local(route.request.url)
    except SystemExit:
        route.abort()
    else:
        route.continue_()


def main():
    if os.getenv('QA_CONFIRM_DISPOSABLE') != 'YES':
        raise SystemExit('Refusing to create fixtures: set QA_CONFIRM_DISPOSABLE=YES only for a fresh test DB.')
    assert_local(WEB); assert_local(API)
    admin_user=os.environ['QA_ADMIN_USERNAME']; admin_password=os.environ['QA_ADMIN_PASSWORD']
    OUT.mkdir(parents=True,exist_ok=True)
    admin=login(admin_user,admin_password)
    config=request('wecom/config',token=admin)
    assert config['outbound_enabled'] is False, 'Real outbound WeCom must be disabled'
    assert config['callback_configured'] is True, 'Set the QA-only callback token, corp ID and AES key'
    assert config['external_customer_chats_supported'] is False
    # Prove the callback is configured with the synthetic key BEFORE creating fixtures.
    checkpath,checkbody=make_callback('qa_probe_'+SUFFIX,'QA PROBE ONLY','probe_'+SUFFIX)
    assert request(checkpath,method='POST',raw=checkbody,content_type='text/xml') == 'success'
    group='QA组-'+SUFFIX; tag='QA标签-'+SUFFIX; segment='QA客户组-'+SUFFIX
    post('people/groups',{'name':group,'description':'synthetic only'},admin)
    tid=post('people/tags',{'name':tag},admin)['id']
    seg=post('customers/segments',{'name':segment,'description':'synthetic only'},admin)['id']
    ct=post('customers/tags',{'name':'QA客户标签-'+SUFFIX},admin)['id']
    customer=post('customers',{'nickname':'QA虚构客户-'+SUFFIX,'identityVerified':False,'contactAllowed':False},admin)
    request(f'customers/{customer["id"]}/classification',method='PUT',token=admin,payload={'segmentId':seg,'tagIds':[ct]})
    found=request('customers?'+urlencode({'segmentId':seg,'tagId':ct}),token=admin)
    assert any(x['id']==customer['id'] for x in found)
    members=[]
    password='Synthetic-Only-'+uuid.uuid4().hex
    for letter in 'AB':
        uid='qa_'+letter+'_'+SUFFIX
        person=post('people',{'personNo':'QA'+letter+SUFFIX,'name':'QA客服'+letter+'-'+SUFFIX,'personType':'support','groupName':group,'wecomUserId':uid},admin)
        request(f'people/{person["id"]}/tags',method='PUT',token=admin,payload={'tagIds':[tid]})
        user='qa-'+letter.lower()+'-'+SUFFIX
        post(f'people/{person["id"]}/credentials',{'username':user,'password':password},admin)
        marker='QA会话正文'+letter+'-'+SUFFIX
        path,body=make_callback(uid,marker,'qa-'+letter+'-'+SUFFIX)
        for _ in range(2):
            assert request(path,method='POST',raw=body,content_type='text/xml')=='success'
        rows=request('wecom/inbox/conversations?'+urlencode({'q':uid}),token=admin)
        thread=next(x for x in rows if x['peer_userid']==uid)
        msgs=request(f'wecom/inbox/conversations/{thread["id"]}/messages',token=admin)
        assert len(msgs)==1 and msgs[0]['content']==marker
        members.append(dict(person=person,uid=uid,user=user,marker=marker,thread=thread,message=msgs[0]))
    a,b=members
    deadline=(datetime.now(timezone.utc)+timedelta(hours=8)).isoformat()
    ticket_title='QA服务工单-'+SUFFIX
    ticket=post('tickets',{'title':ticket_title,'description':'synthetic acceptance fixture','assigneeId':b['person']['id'],'deadline':deadline,'priority':'HIGH','sourceMessageId':b['message']['id']},admin)
    ticket_id=ticket['id']
    assert ticket['type']=='SERVICE_TICKET' and ticket['sla']['response_due_at'] is not None
    worker=login(b['user'],password)
    other=login(a['user'],password)
    request(f'tasks/{ticket_id}',token=other,expected=403)
    for path in ('wecom/inbox/conversations','sla/policies','reports/tickets'):
        request(path,token=worker,expected=403)
    report=request('reports/tickets?'+urlencode({'group':group,'tagId':tid}),token=admin)
    assert report['summary']['total']>=1
    print('PASS synthetic API setup, signed callback dedupe, grouping, ownership and report checks',flush=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        desk=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
        desk.route('**/*',browser_guard)
        page=desk.new_page()
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        try:
            page.goto(WEB+'/login');login_browser(page,admin_user,admin_password)
            expect(page).to_have_url(WEB+'/admin')
            page.goto(WEB+'/admin/messages')
            expect(page.get_by_text('企业微信聚合消息工作台',exact=True)).to_be_visible()
            row_a=page.locator('.inbox-item').filter(has_text=a['person']['name'])
            row_b=page.locator('.inbox-item').filter(has_text=b['person']['name'])
            expect(row_a).to_be_visible();expect(row_b).to_be_visible()
            # Delay A through the actual BFF, select B, then allow old A to resolve.
            # Use asynchronous browser JS to delay a fetch without blocking Playwright's event loop.
            page.evaluate('''(id)=>{const orig=window.fetch;window.fetch=async(...args)=>{const result=await orig(...args);if(String(args[0]).includes('/conversations/'+id+'/messages'))await new Promise(r=>setTimeout(r,1400));return result;};}''',str(a['thread']['id']))
            row_a.click();row_b.click()
            expect(page.locator('.inbox-stream').get_by_text(b['marker'],exact=True)).to_be_visible()
            page.wait_for_timeout(1700)
            expect(page.locator('.inbox-stream').get_by_text(b['marker'],exact=True)).to_be_visible()
            expect(page.locator('.inbox-stream').get_by_text(a['marker'],exact=True)).to_have_count(0)
            expect(page.get_by_role('button',name='发送应用消息')).to_be_disabled()
            shot(page,'01-message-workbench')
            page.get_by_role('button',name='创建工单',exact=True).click()
            expect(page.locator('textarea:visible').last).to_have_value(b['marker'])
            ui_title='QA工作台建单-'+SUFFIX
            modal_form=page.locator('form').filter(has=page.locator('select')).last
            modal_form.locator('input').first.fill(ui_title)
            modal_form.locator('select').first.select_option(str(b['person']['id']))
            shot(page,'02-ticket-from-message')
            modal_form.get_by_role('button',name='创建工单',exact=True).click()
            expect(page.get_by_text('工单已创建',exact=True)).to_be_visible()
            expect(page.locator('.related-ticket').filter(has_text=ui_title)).to_be_visible()
            ui_tasks=request('tasks?'+urlencode({'q':ui_title}),token=admin)
            created=next(t for t in ui_tasks if t['title']==ui_title)
            assert created['source_message_id']==b['message']['id'], 'Wrong source message associated with ticket'
            print('PASS browser-created ticket links to the selected conversation',flush=True)
            page.get_by_role('button',name='任务通知 / 催办记录').click()
            expect(page.get_by_text('SENT 表示企业微信接口接受了消息',exact=False)).to_be_visible()
            shot(page,'03-outbox')
            for section,heading,name in [
                ('tasks','统一任务工单中心','04-service-tickets'),
                ('sla','工单 SLA 策略','05-sla-policies'),
                ('people','人员、分组与标签','06-people-groups-tags'),
                ('customers','客户档案管理','07-customer-groups-tags'),
                ('reports','工单运营与 SLA 统计','08-ticket-reports')]:
                page.goto(WEB+'/admin/'+section)
                expect(page.get_by_text(heading,exact=True)).to_be_visible()
                if section=='tasks':expect(page.get_by_text(ticket_title,exact=True).first).to_be_visible()
                if section=='people':expect(page.get_by_text(b['person']['name'],exact=True).first).to_be_visible()
                if section=='customers':expect(page.get_by_text(customer['nickname'],exact=True).first).to_be_visible()
                if section=='reports':
                    expect(page.locator('.kpi-value').first).not_to_have_text('—')
                    page.locator('select.filter-select').nth(0).select_option(group)
                    page.locator('select.filter-select').nth(1).select_option(str(tid))
                    page.get_by_role('button',name='查询统计').click()
                    expect(page.locator('.kpi-value').first).to_have_text('2')
                shot(page,name)
            mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
            mobile.route('**/*',browser_guard)
            mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append(str(e)))
            card=WEB+f'/m/tasks/{ticket_id}'
            mp.goto(card)
            expect(mp).to_have_url(re.compile(re.escape(WEB)+r'/login\?[^#]*next='))
            shot(mp,'09-card-login')
            login_browser(mp,b['user'],password)
            expect(mp).to_have_url(card)
            expect(mp.get_by_role('heading',name=ticket_title)).to_be_visible()
            shot(mp,'10-mobile-card-task')
            assert not errors, f'Browser page errors: {len(errors)}'
            print('PASS browser route smoke + delayed conversation switch + card login-return',flush=True)
            # Exercise real backend submission and admin review using only the synthetic fixture.
            post(f'tasks/{ticket_id}/submissions',{'payload':{'notes':'QA synthetic result'}},worker)
            completed=post(f'tasks/{ticket_id}/review',{'decision':'APPROVE'},admin)
            assert completed['status']=='COMPLETED' and completed['sla']['resolved_at'] is not None
            page.goto(WEB+'/admin/tasks');expect(page.get_by_text(ticket_title,exact=True)).to_be_visible()
            shot(page,'11-completed-ticket')
            print('PASS service ticket submit/review/resolution via API',flush=True)
        except Exception:
            shot(page,'FAILED-desktop-state')
            if 'mp' in locals():shot(mp,'FAILED-mobile-state')
            raise
        finally:
            browser.close()
    print('PASS all executed smoke checks; no external WeCom API used',flush=True)

if __name__=='__main__':
    main()
