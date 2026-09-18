# provincias.csv / localidades.csv

Real data for `provincias` and `localidades` (see `../0001_init_schema.sql`),
sourced from Argentina's official geographic API (BAHRA / IGN, via
`apis.datos.gob.ar/georef`) on 2026-09-17.

## provincias.csv — 24 rows

All 23 provinces except Buenos Aires is split into two entries, and CABA is
folded into AMBA instead of standing alone (per your instructions):

- `AMBA` (id 1) — CABA + the 40 partidos usually counted in the Área
  Metropolitana de Buenos Aires (Observatorio Metropolitano's list).
- `Buenos Aires` (id 2) — the other 95 partidos of Buenos Aires province
  (everything outside AMBA).
- The other 22 provinces, ids 3–24.

`comuna` is set to `1` for every row (placeholder — same column UbicaBA uses
to flag "special/admin-added" entries via `comuna = 0`; nothing uses that
here yet).

## localidades.csv — 3,594 rows

Granularity is **not uniform** across the country, by design (per your
"los partidos cuentan como localidad" instruction):

- **AMBA (41 rows):** one point per AMBA partido (using each partido's
  official municipio centroid from georef) + one point for `CABA` itself
  (city-wide centroid). Neighborhoods like Martínez/Beccar are NOT separate
  rows — they're inside `San Isidro`'s one row, same as every other AMBA
  partido.
- **Buenos Aires interior + every other province (3,553 rows):** full BAHRA
  granularity — every named locality/settlement, not aggregated by partido/
  departamento. This is why, e.g., Córdoba province alone has 502 rows.

Row counts by provincia_id: AMBA 41, Buenos Aires 526, Catamarca 161, Chaco
91, Chubut 90, Córdoba 502, Corrientes 76, Entre Ríos 177, Formosa 62, Jujuy
154, La Pampa 89, La Rioja 91, Mendoza 205, Misiones 140, Neuquén 58, Río
Negro 145, Salta 127, San Juan 91, San Luis 90, Santa Cruz 26, Santa Fe 386,
Santiago del Estero 160, Tierra del Fuego 4, Tucumán 102.

`pool_index` is sequential (0..3593) in the order the rows appear in the CSV.
`image_url` is left blank for every row — nothing populates it yet.

## Known caveats

- The AMBA partido list (40 partidos) is the commonly-cited "AMBA extendida"
  definition, not the stricter classic GBA24 — if you'd rather use GBA24 (24
  partidos + CABA, with everything else folding into "Buenos Aires"), say so
  and I'll regenerate both CSVs.
- Coordinates are each place's official centroid, not necessarily its most
  recognizable landmark — fine for a geoguessing game's purposes, but a few
  sparse/rural entries may sit on unremarkable ground.
- Source data instant: BAHRA via georef API, snapshot taken 2026-09-17. If
  the government updates BAHRA later, these rows won't auto-refresh.

## How to import

Both tables already exist (`ubicarg/0001_init_schema.sql`). In Supabase
Studio: **Table Editor → provincias → Insert → Import data from CSV** (use
`provincias.csv`), then the same for `localidades` (use `localidades.csv`).
Import `provincias.csv` first — `localidades.provincia_id` has a foreign key
into it.
