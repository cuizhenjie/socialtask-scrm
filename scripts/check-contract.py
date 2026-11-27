#!/usr/bin/env python3
"""Static deployment checks; real route/DB behavior is covered by test-next-runtime.mjs."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
def read(file):
    return (root / file).read_text()

api = root / 'apps/web/src/lib/api'
next_paths = [(m, re.sub(r':\w+', ':parameter', p)) for f in api.glob('routes*.ts')
              for m, p in re.findall(r'method: "(\w+)", path: "([^"]+)"', f.read_text())]
compose = read('infra/compose.yaml')
ci = read('.github/workflows/ci.yml')
nginx = read('infra/nginx.example.conf')
checks = {
    'all 85 prior business routes and readiness, without duplicates': len(next_paths) == len(set(next_paths)) == 86,
    'no legacy server directory': not (root / 'services/api').exists(),
    'no legacy HTTP endpoint in deployment': '8080' not in nginx and 'API_INTERNAL_URL' not in compose,
    'callback routes to Next': '/api/v1/wecom/callback' in nginx and '127.0.0.1:3000' in nginx,
    'same service uses external Supabase config': 'env_file: .env' in compose and 'PGRST_DB_URI' not in compose,
    'private bucket migration': "'socialtask-attachments',false" in read('supabase/storage.sql'),
    'service credential is only read from a private env name': 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY' not in read('apps/web/src/lib/api/supabase.ts'),
    'CI runs Next runtime integration': 'test-next-runtime.mjs' in ci and 'setup-java' not in ci,
}
for name, ok in checks.items():
    print(('PASS ' if ok else 'FAIL ') + name)
assert all(checks.values())
