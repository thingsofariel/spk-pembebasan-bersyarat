# SPK Pemberian Hak Pembebasan Bersyarat — TOPSIS

Sistem Pendukung Keputusan (SPK) untuk membantu proses pemberian hak pembebasan
bersyarat narapidana menggunakan metode **TOPSIS**, dengan tiga level akses:

| Level | Peran | Deskripsi |
|---|---|---|
| 0 | **Kepala Lapas** (`kepala_lapas`) | Menerima laporan akhir dari Koordinator Wali, memonitor seluruh data narapidana, mengelola akun pengguna. |
| 1 | **Koordinator Wali Pemasyarakatan** (`koordinator_wali`) | Menerima laporan dari tiap Wali, mengelola kriteria/sub-kriteria/periode, meneruskan laporan ke Kepala Lapas. |
| 2 | **Wali Pemasyarakatan** (`wali`) | Mengelola narapidana binaannya, mengisi penilaian, menjalankan perhitungan TOPSIS, mengirim laporan ke Koordinator. |

This mirrors the reporting chain you described: **guardian → guardian coordinator → warden**, and matches the `Role` / `koordinator_id` / `File Distribusi` design already present in your thesis's data model (Tabel 3.15 & 3.22).

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**. The database is created and seeded automatically on first run (SQLite file at `data/parole_dss.sqlite`).

**Demo accounts:**

| Username | Password | Role |
|---|---|---|
| `kalapas` | `kalapas123` | Kepala Lapas |
| `koordinatorwali` | `koor123` | Koordinator Wali |
| `waliA` | `wali123` | Wali (has 5 sample narapidana + scores already entered — try the TOPSIS calculation right away) |
| `waliB` | `wali123` | Wali (no narapidana yet, to test the empty-state flow) |

**Requirements:** Node.js **≥ 22.5** (needed for the built-in `node:sqlite` module — see below).

To start fresh: stop the server, delete `data/parole_dss.sqlite`, and restart.

## Why this stack

You asked for Node.js/Express + SQLite with no separate DB server, so I made a
few deliberate choices to keep the project easy to install and run:

- **`node:sqlite` (built-in), not `better-sqlite3`** — Node 22.5+ ships a
  synchronous SQLite driver in core. It has the same "prepare → run/get/all"
  shape as `better-sqlite3`, but needs **zero native compilation**, so
  `npm install` can't fail on missing build tools. The one gap: it has no
  `.transaction()` convenience method, so `src/config/db.js` exports a small
  `withTransaction()` helper (`BEGIN`/`COMMIT`/`ROLLBACK`) used wherever
  multiple writes need to be atomic (saving penilaian, saving TOPSIS results).
  It's still flagged "experimental" by Node itself — stable enough for this
  use case, but worth knowing.
- **Built-in `crypto.scrypt`, not `bcrypt`/`bcryptjs`** — same reasoning:
  one less dependency, no native bindings, nothing to fail to install.
  See `src/utils/password.js`.
- **Only 3 npm dependencies**: `express`, `express-session`, `ejs`. Session
  storage is in-memory (fine for a single-instance thesis defense/demo — see
  "Known limitations" below for production notes).
- Reports sent up the chain (guardian → coordinator → warden) are generated
  as **CSV** (plain Node `fs`, no PDF library) so there's no risk of a
  dependency failing to install right before your defense. If you'd like a
  formatted PDF instead, that's a small addition — just ask.

## The TOPSIS engine

`src/services/topsis.js` is a pure, dependency-free module (no DB, no HTTP)
so it's easy to test and reuse. It implements the method exactly as your
thesis formally states it in Section 2.5, **using vector normalization**
(per your instruction), not the linear max/min normalization used in your
worked example (Tables 3.12–3.14):

1. **Normalize** — `rᵢⱼ = Xᵢⱼ / √Σ Xᵢⱼ²` (Persamaan 2.1)
2. **Weight** — `yᵢⱼ = wⱼ · rᵢⱼ` (Persamaan 2.2)
3. **Ideal solutions** — A⁺ = best per column, A⁻ = worst per column, direction depending on benefit/cost (Persamaan 2.3–2.4)
4. **Distances** — Euclidean distance to A⁺ and A⁻ (Persamaan 2.5–2.6)
5. **Preference score** — `Vᵢ = Dᵢ⁻ / (Dᵢ⁻ + Dᵢ⁺)` (Persamaan 2.7)
6. **Rank** descending by Vᵢ.

Run `npm run test:topsis` to see it validated against your thesis's own
5-narapidana example — the top 2 ranks match exactly; ranks 3–5 differ
slightly, which is expected since vector normalization treats the data
differently than the linear max/min method your worked example used.

**Eligibility rule ("Lulus"/"Tidak Lulus")**: your thesis isn't fully
consistent about how this cutoff was decided (the appendix table's
prose names don't quite match its own ranking). Rather than guess, I made it
**configurable per periode** (Koordinator Wali sets it):
- `threshold` mode — `Vᵢ ≥ nilai` (default `0.5`, matching your 15-alternative table)
- `quota` mode — top *N* ranks pass, for a fixed number of parole slots

## Project structure

```
src/
  config/db.js         SQLite connection, schema, seed data
  middleware/auth.js    session auth + role guards
  middleware/csrf.js     lightweight CSRF (no extra dependency)
  services/topsis.js     the TOPSIS engine (pure, unit-testable)
  utils/password.js      scrypt password hashing
  utils/report.js        CSV report generation
  routes/auth.js         login/logout
  routes/warden.js       Level 0 routes
  routes/coordinator.js  Level 1 routes
  routes/guardian.js     Level 2 routes (the core TOPSIS flow)
  views/                 EJS templates, organized by role
public/css/style.css     hand-written design system (no CSS framework)
tests/topsis.manual-check.js   validates the engine against your thesis data
uploads/                 generated CSV reports land here
data/                    the SQLite database file
```

## Design decisions worth flagging

- **Who manages what** — your original thesis had one "Admin" role doing
  everything. Splitting into 3 roles meant deciding who owns which master
  data. I assigned: Koordinator Wali manages **kriteria, sub-kriteria,
  tindak pidana, and periode** (so scoring stays standardized across every
  wali under them); Wali manages their **own narapidana and penilaian**;
  Kepala Lapas manages **user accounts** and has read-only visibility into
  everything. If you'd rather split this differently (e.g., Kepala Lapas
  should own kriteria instead), that's a straightforward change — tell me
  and I'll move it.
- **TOPSIS is run per-wali, per-periode** — each guardian ranks only their
  own assigned narapidana, matching "the guardian is the one who makes the
  decision" from your brief. Let me know if you actually want one combined
  ranking across all narapidana in a periode instead.
- **Scoring uses your sub-kriteria (Likert) system** — wali pick a
  descriptive condition (e.g. "Nilai sangat baik saat mengikuti program
  pembinaan (80-100)") from a dropdown rather than typing a raw number
  directly, exactly like Tables 3.6–3.11 in your thesis.

## Known limitations (fine for a thesis demo, worth knowing)

- Sessions are stored in memory — they reset when the server restarts, and
  won't scale past one server process. Fine for a defense/demo; for real
  deployment you'd want a persistent session store.
- No automated test suite beyond the TOPSIS engine check — I wasn't able to
  install Express/EJS in the sandbox I built this in (no network access
  there), so the routes and views are carefully written but not
  machine-verified end-to-end. Please run through the three logins after
  `npm install` and tell me about anything that breaks — I'll fix it fast.
- File uploads (e.g. attaching a scanned document to a report) aren't
  implemented — reports are auto-generated CSVs. Happy to add upload support
  with `multer` if you need it.

## Next steps / things I can add on request

- PDF report generation instead of CSV
- A dedicated "hasil" page showing historical results per narapidana across periods
- Charts (e.g. score distribution) on the dashboards
- Export to Excel
- Bulk-import narapidana from CSV
