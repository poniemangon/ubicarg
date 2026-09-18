# -*- coding: utf-8 -*-
# Re-seeds the `localidades` table from localidades.csv: deletes every
# existing row, then re-inserts. Needs the project's service_role key
# (Supabase Dashboard > Project Settings > API Keys) — NEVER hardcode it
# here; pass it as an env var so it can't end up committed to git:
#
#   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx python3 reload_localidades.py
#
import csv, json, os, sys, urllib.request, urllib.error

SUPA_URL = os.environ.get('SUPABASE_URL')
SUPA_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not SUPA_URL or not SUPA_KEY:
    sys.exit('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.')

def req(method, path, body=None, extra_headers=None):
    url = f"{SUPA_URL}{path}"
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('apikey', SUPA_KEY)
    r.add_header('Authorization', f'Bearer {SUPA_KEY}')
    if body is not None:
        r.add_header('Content-Type', 'application/json')
    for k, v in (extra_headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

# Delete every existing row (comments would cascade, but there are none).
status, body = req('DELETE', '/rest/v1/localidades?pool_index=gte.0', extra_headers={'Prefer': 'return=minimal'})
print('delete status:', status, body[:200])

with open('localidades.csv', encoding='utf-8') as f:
    rows = list(csv.DictReader(f))
for r in rows:
    r['pool_index'] = int(r['pool_index'])
    r['provincia_id'] = int(r['provincia_id'])
    r['lat'] = float(r['lat'])
    r['lng'] = float(r['lng'])
    if r['image_url'] == '':
        r['image_url'] = None

BATCH = 500
failures = []
for i in range(0, len(rows), BATCH):
    chunk = rows[i:i+BATCH]
    status, body = req('POST', '/rest/v1/localidades', chunk, extra_headers={'Prefer': 'return=minimal'})
    ok = status in (200, 201)
    print(f'batch {i}-{i+len(chunk)-1}: status={status} ok={ok}' + ('' if ok else f' body={body[:300]}'))
    if not ok:
        failures.append(i)

print('DONE. failures:', len(failures))
