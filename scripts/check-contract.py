#!/usr/bin/env python3
"""Static source/schema contract verification. NOT a substitute for MySQL or compilation."""
from pathlib import Path
import re, sys
ROOT=Path(__file__).resolve().parents[1]
SQL=(ROOT/'services/api/src/main/resources/db/migration/V1__baseline.sql').read_text()
V2=(ROOT/'services/api/src/main/resources/db/migration/V2__inbox_sla_tags.sql').read_text()
V3=(ROOT/'services/api/src/main/resources/db/migration/V3__customer_segmentation.sql').read_text()
COMPOSE=(ROOT/'infra/compose.yaml').read_text()
APP=(ROOT/'services/api/src/main/resources/application.yml').read_text()
ENV=(ROOT/'.env.example').read_text()
README=ROOT/'README.md'
checks=[]
def check(ok,why):
    checks.append((bool(ok),why))
    if not ok: print('FAIL',why,file=sys.stderr)
tables=set(re.findall(r'^CREATE TABLE\s+(\w+)\s*\(',SQL,re.M|re.I))
expected=set('people users sessions social_accounts attachments content_packages publish_batches customers customer_identities contact_rounds tasks works comments customer_sources task_submissions contact_attempts notifications audit_logs'.split())
check(tables==expected,'18 required MySQL V1 tables')
v2tables=set(re.findall(r'^CREATE TABLE\s+(\w+)\s*\(',V2,re.M|re.I))
check(v2tables==set('people_groups tags people_tag_links sla_policies task_sla wecom_conversations wecom_messages'.split()),'7 required MySQL V2 tables')
v3tables=set(re.findall(r'^CREATE TABLE\s+(\w+)\s*\(',V3,re.M|re.I))
check(v3tables==set('customer_segments customer_tags customer_tag_links'.split()),'3 required MySQL V3 customer segmentation tables')
for phrase in ['fk_customer_segment','idx_customer_segment','customer_tag_links','tag_id','segment_id']:
    check(phrase in V3,f'V3 contract: {phrase}')
for phrase in ['uq_sla_scope','uq_wecom_conversation','msg_key CHAR(64)','FOREIGN KEY(source_message_id)','response_warning_minutes','resolution_warning_minutes','provider_msgid','attempted_at']:
    check(phrase in V2,f'V2 contract: {phrase}')
for phrase in ['UNIQUE KEY uq_identity','UNIQUE KEY uq_customer_round','UNIQUE KEY uq_customer_source','UNIQUE KEY uq_task_revision','url_hash CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE','event_key VARCHAR(170) NOT NULL UNIQUE']:
    check(phrase in SQL,f'MySQL uniqueness: {phrase}')
for name in ['mysql','api','web']:
    check(re.search(rf'^  {name}:\s*$',COMPOSE,re.M) is not None,f'Compose {name} service')
for name in ['MYSQL_ROOT_PASSWORD','DB_PASSWORD','BOOTSTRAP_ADMIN_USERNAME','BOOTSTRAP_ADMIN_PASSWORD','WECOM_ENABLED','WECOM_CALLBACK_ENABLED','WECOM_CALLBACK_TOKEN','WECOM_ENCODING_AES_KEY','FOLLOWUP_MAX_ACTIVE_TASKS']:
    check(f'{name}=' in ENV,f'.env.example {name}')
for name in ['auth','people','content','customer','notification','storage','task','work','sla','wecom','report']:
    check((ROOT/f'services/api/src/main/java/com/socialtask/{name}').is_dir(),f'Java {name} module')
for name in ['admin','m','login']:
    exists=(ROOT/f'apps/web/src/app/{name}').is_dir() or name=='admin' and (ROOT/'apps/web/src/app/(admin)/admin').is_dir()
    check(exists,f'Next {name} route')
for f in ['docs/API.md','docs/architecture.md','docs/acceptance.md','docs/migration.md','docs/verification/STATUS.md','services/api/src/test/java/com/socialtask/WorkflowIntegrationTest.java','services/api/src/test/java/com/socialtask/EnhancementsIntegrationTest.java','services/api/src/test/java/com/socialtask/WecomCallbackIntegrationTest.java']:
    check((ROOT/f).exists(),f'Artifact {f}')
for name in ['SlaPolicies','TicketReports','Messages','People','Tasks','Customers']:
    check((ROOT/f'apps/web/src/components/sections/{name}.tsx').exists(),f'New admin page {name}')
check(not (ROOT/'infra/.env').exists(),'No real infra/.env secret committed to bundle')
print(f'{"PASS" if all(x[0] for x in checks) else "FAIL"}: {sum(x[0] for x in checks)}/{len(checks)} static engineering contract checks ({len(tables)} original + {len(v2tables)} V2 + {len(v3tables)} V3 tables)')
sys.exit(0 if all(x[0] for x in checks) else 1)
