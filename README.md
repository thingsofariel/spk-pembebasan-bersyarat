# SPK Pemberian Hak Pembebasan Bersyarat — TOPSIS

Sistem Pendukung Keputusan (SPK) untuk membantu proses pemberian hak pembebasan
bersyarat narapidana menggunakan metode **TOPSIS**, dengan tiga level akses:

| Level | Peran | Deskripsi |
|---|---|---|
| 0 | **Kepala Lapas** (`kepala_lapas`) | Menerima laporan akhir dari Koordinator Wali, memonitor seluruh data narapidana, mengelola akun pengguna. |
| 1 | **Koordinator Wali Pemasyarakatan** (`koordinator_wali`) | Menerima laporan dari tiap Wali, mengelola kriteria/sub-kriteria/periode, meneruskan laporan ke Kepala Lapas. |
| 2 | **Wali Pemasyarakatan** (`wali`) | Mengisi penilaian narapidana binaannya (read-only untuk data induk narapidana), menjalankan perhitungan TOPSIS, mengirim laporan ke Koordinator. |

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
  data. As of the July 2026 UI update: Koordinator Wali manages **kriteria,
  sub-kriteria, tindak pidana, periode, and narapidana data** (under the new
  "LMS · Lapas Management System" sidebar menu) for every wali under them —
  this keeps data entry standardized. Wali now has **read-only** access to
  their narapidana list and focuses on **penilaian and perhitungan TOPSIS**;
  Kepala Lapas manages **user accounts** and has read-only visibility into
  everything. If you'd rather split this differently, that's a
  straightforward change — tell me and I'll move it.
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

## Changelog — July 2026 UI/UX overhaul

Continuing from the earlier project checkpoint (login page glassmorphism), this
pass covered six requested changes:

1. **Public profile website** (`/`) — a new scrollable single-page site for
   Lapas Kelas IIA Kupang: hero section, an About section with an editable
   text box plus a 5-photo gallery grid (frames degrade gracefully to a
   placeholder icon until real photos are dropped into
   `public/images/gallery/`), an "Our Programs" section, and a Contact
   section with a client-side-only message form. **The narrative text and
   contact details are placeholders marked with `TODO` comments in
   `src/views/public/landing.ejs` — please replace them with the Lapas's
   real, verified information before this goes live.**
2. **Anchored navbar** — Home / About / Our Programs / Contact scroll
   smoothly to sections on the same page; only Login navigates away, to
   `/login`.
3. **Profile pages for all three roles** (`/warden/profil`,
   `/koordinator/profil`, `/wali/profil`) — view account info and change
   password (current-password verification required). Every dashboard page
   now also shows a breadcrumb ("Halaman Koordinator Wali / Periode
   Penilaian / Tambah Periode Penilaian") so it's always clear which screen
   you're on.
4. **More interactivity** — hover-lift cards, animated stat counters,
   reveal-on-scroll sections on the landing page, a scroll-shrinking navbar,
   password show/hide toggles, and a collapsible sidebar menu — all in
   vanilla CSS/JS, no new dependencies.
5. **Narapidana management moved to Koordinator Wali** — Wali's data is now
   read-only. Koordinator's sidebar has a new collapsible **"LMS · Lapas
   Management System"** menu holding Kriteria, Periode, Tindak Pidana, and
   Data Narapidana. Every data table (narapidana, kriteria, sub-kriteria,
   periode, tindak pidana, user accounts) now has a Lihat/Ubah/Hapus
   (eye/pencil/trash) action group; "Lihat" opens a detail modal, and small
   edits (sub-kriteria, tindak pidana) happen in an inline modal form instead
   of a separate page.
6. **Logo card** — a small institutional mark (shield + key motif, *not* an
   official government seal) now appears in the sidebar, the public navbar,
   and the login card, via a shared `src/views/partials/logo.ejs` partial.

**Judgment calls made without your sign-off — flag if you want these changed:**
- Periode deletion now cascades to that periode's `penilaian` and
  `hasil_topsis` rows (the schema already had `ON DELETE CASCADE`); the
  confirm dialog warns about this before deleting.
- A logged-in account can no longer change its own `role` from the edit
  form (self-lockout guard) — an admin can still change *other* accounts'
  roles freely.
- The hero/background photo (`Lapas.png`, ~2 MB) now has a compressed
  `Lapas-web.jpg` companion (~180 KB) used everywhere on the public site and
  login page for faster load times. The original PNG is untouched in case
  you need the full-resolution file elsewhere.
- Laporan (report) tables were **not** converted to the eye/pencil/trash
  pattern — their existing Unduh / Tandai Diterima / Teruskan actions were
  kept since laporan aren't user-editable master data.

**Still not verified end-to-end** (same sandbox limitation as before — no
network access to `npm install` Express/EJS): I re-ran every DB-layer query
these routes use directly against a live SQLite file (`tests/route-logic.manual-check.js`,
22/22 checks pass) and validated every `.ejs` file's `include()` paths and
tag balance (`tests/ejs-check.js`, 31/31 clean), but the actual HTTP
request/response cycle and rendered HTML have not been exercised in a
browser. Please run `npm install && npm start`, click through all three
logins, and let me know what breaks.
