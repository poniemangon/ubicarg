# UbicaRG

Adiviná la localidad exacta en el mapa de Argentina. Jugá el desafío del día o desafiá a tus amigos — mismo juego que [UbiCABA](https://github.com/poniemangon/baires-geoguess), pero de escala país: provincias en vez de barrios, localidades en vez de esquinas.

## Desarrollo local

```bash
npm install
npm run dev
```

Necesita un `.env` con:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Base de datos

El esquema vive en `supabase/migrations/` — corré los archivos en orden en el SQL Editor de Supabase:

- `0001_init_schema.sql` — esquema completo (tablas, RLS, funciones, triggers). Crea `provincias`/`localidades` vacías.
- `0002_score_formula_1km.sql`, `0004_score_formula_4km.sql` — ajustes a la fórmula de puntaje de los duelos contra bots.
- `0003_admin_flag.sql` — agrega `profiles.is_admin` (ver más abajo).

Los datos reales de provincias/localidades (24 provincias, ~3600 localidades, fuente: [BAHRA](http://www.bahra.gob.ar/) vía la [API de georef](https://apis.datos.gob.ar/georef/)) están en `supabase/seed-data/` — importalos desde Table Editor → Insert → Import data from CSV (primero `provincias.csv`, después `localidades.csv`, en ese orden por la FK).

## Auth

Supabase Auth nativo (Google OAuth + email/contraseña), sin Clerk. Habilitá los providers en Authentication → Providers, y configurá Site URL / Redirect URLs en Authentication → URL Configuration.

Los admins son perfiles con `is_admin = true` — registrate como jugador normal y despues, una vez:

```sql
update profiles set is_admin = true where username = '<tu usuario>';
```
