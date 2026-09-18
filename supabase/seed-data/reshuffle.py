# -*- coding: utf-8 -*-
import csv, random

rows = list(csv.DictReader(open('localidades.csv', encoding='utf-8')))
caba = [r for r in rows if r['nombre'] == 'CABA' and r['pool_index'] == '0']
assert len(caba) == 1, caba
rest = [r for r in rows if not (r['nombre'] == 'CABA' and r['pool_index'] == '0')]

rng = random.Random(20260101)  # fixed seed, reproducible
rng.shuffle(rest)

out = caba + rest
for idx, r in enumerate(out):
    r['pool_index'] = idx

with open('localidades.csv', 'w', encoding='utf-8', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['pool_index', 'nombre', 'provincia_id', 'lat', 'lng', 'image_url'])
    w.writeheader()
    for r in out:
        w.writerow(r)

print('total rows:', len(out))
print('pool_index 0 ->', out[0]['nombre'])
# Sanity: no run of 5+ consecutive same-provincia rows anywhere
run_prov = None
run_len = 0
max_run = 0
for r in out:
    if r['provincia_id'] == run_prov:
        run_len += 1
    else:
        run_prov = r['provincia_id']
        run_len = 1
    max_run = max(max_run, run_len)
print('longest same-provincia run after shuffle:', max_run)
