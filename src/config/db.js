const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('../utils/password');

/**
 * node:sqlite's DatabaseSync does NOT have better-sqlite3's convenience
 * `.transaction(fn)` wrapper, so we provide a small equivalent here.
 * Exported for reuse by route modules.
 */
function withTransaction(database, fn) {
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'parole_dss.sqlite');

// Ensure the data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
-- =========================================================================
-- Users: the three roles from the thesis (Section 4.3.3 / 4.3.13):
--   'kepala_lapas'      = Level 0 - Prison Warden
--   'koordinator_wali'  = Level 1 - Guardian Coordinator
--   'wali'              = Level 2 - Guardian
-- koordinator_id links a wali/koordinator to their coordinator, mirroring
-- Tabel 3.15 (User) in the thesis.
-- =========================================================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('kepala_lapas','koordinator_wali','wali')),
  koordinator_id INTEGER REFERENCES users(id),
  foto_profil   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabel 3.19 Tindak Pidana
CREATE TABLE IF NOT EXISTS tindak_pidana (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis         TEXT NOT NULL,
  pasal_kuhp    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabel 3.16 Narapidana
CREATE TABLE IF NOT EXISTS narapidana (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nama                TEXT NOT NULL,
  agama               TEXT,
  tempat_lahir        TEXT,
  tanggal_lahir       TEXT,
  umur                INTEGER,
  alamat              TEXT,
  pendidikan_terakhir TEXT,
  nomor_ktp           TEXT,
  kategori_register   TEXT,
  tindak_pidana_id    INTEGER REFERENCES tindak_pidana(id),
  pekerjaan_semula    TEXT,
  masa_tahanan        TEXT,
  wali_id             INTEGER REFERENCES users(id),
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabel 3.17 Kriteria
CREATE TABLE IF NOT EXISTS kriteria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL,
  jenis         TEXT NOT NULL CHECK (jenis IN ('benefit','cost')),
  bobot         REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabel 3.18 Sub-Kriteria (the Likert-scale range mapping, Tables 3.6-3.11)
CREATE TABLE IF NOT EXISTS sub_kriteria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kriteria_id   INTEGER NOT NULL REFERENCES kriteria(id) ON DELETE CASCADE,
  deskripsi     TEXT NOT NULL,
  nilai_skala   REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabel 3.21 Periode
CREATE TABLE IF NOT EXISTS periode (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_periode        TEXT NOT NULL,
  tahun               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','dihitung','ditutup')),
  eligibility_mode     TEXT NOT NULL DEFAULT 'threshold' CHECK (eligibility_mode IN ('threshold','quota')),
  eligibility_value    REAL NOT NULL DEFAULT 0.5,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabel 3.20 Penilaian: the raw score (Xij) given by a wali to a narapidana,
-- per criterion, per period. This is the TOPSIS input data.
CREATE TABLE IF NOT EXISTS penilaian (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  narapidana_id   INTEGER NOT NULL REFERENCES narapidana(id) ON DELETE CASCADE,
  kriteria_id     INTEGER NOT NULL REFERENCES kriteria(id) ON DELETE CASCADE,
  sub_kriteria_id INTEGER REFERENCES sub_kriteria(id),
  periode_id      INTEGER NOT NULL REFERENCES periode(id) ON DELETE CASCADE,
  nilai           REAL NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(narapidana_id, kriteria_id, periode_id)
);

-- Stores the computed TOPSIS result per narapidana per period, so reports
-- can be viewed later without recomputing.
CREATE TABLE IF NOT EXISTS hasil_topsis (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  periode_id      INTEGER NOT NULL REFERENCES periode(id) ON DELETE CASCADE,
  narapidana_id   INTEGER NOT NULL REFERENCES narapidana(id) ON DELETE CASCADE,
  wali_id         INTEGER REFERENCES users(id),
  nilai_preferensi REAL NOT NULL,
  peringkat       INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('Lulus','Tidak Lulus')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(periode_id, narapidana_id)
);

-- Tabel 3.22 File Distribusi: the guardian -> coordinator -> warden reporting
-- chain described in Section 4.3.12.
CREATE TABLE IF NOT EXISTS distribusi_file (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  judul           TEXT NOT NULL,
  deskripsi       TEXT,
  file_path       TEXT NOT NULL,
  periode_id      INTEGER REFERENCES periode(id),
  dari_user_id    INTEGER NOT NULL REFERENCES users(id),
  ke_user_id      INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'terkirim' CHECK (status IN ('terkirim','diterima')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(SCHEMA);

/**
 * Lightweight migration runner for columns added after a database file was
 * first created. `CREATE TABLE IF NOT EXISTS` above only helps on a brand
 * new install — an existing parole_dss.sqlite (like the one already on your
 * machine) needs these columns added explicitly. Safe to run every startup:
 * each ALTER only fires if the column isn't already there.
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migrated: added ${table}.${column}`);
  }
}

function runMigrations() {
  ensureColumn('users', 'foto_profil', 'TEXT');
  ensureColumn('narapidana', 'created_by', 'INTEGER REFERENCES users(id)');
}

runMigrations();

function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (count > 0) return; // already seeded

  const insertUser = db.prepare(
    `INSERT INTO users (nama, username, password_hash, email, role, koordinator_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Default accounts - CHANGE THESE PASSWORDS after first login in production.
  const hash = (pw) => hashPassword(pw);

  const kalapasId = insertUser.run(
    'Kepala Lapas Kelas IIA Kupang', 'kalapas', hash('kalapas123'),
    'kalapas@lapaskupang.go.id', 'kepala_lapas', null
  ).lastInsertRowid;

  const koordinatorId = insertUser.run(
    'Eric Wonlele', 'koordinatorwali', hash('koor123'),
    'koordinator@lapaskupang.go.id', 'koordinator_wali', null
  ).lastInsertRowid;

  const waliId = insertUser.run(
    'Muhammad Zeinal', 'waliA', hash('wali123'),
    'wali.a@lapaskupang.go.id', 'wali', koordinatorId
  ).lastInsertRowid;

  const wali2Id = insertUser.run(
    'Andy Baso', 'waliB', hash('wali123'),
    'wali.b@lapaskupang.go.id', 'wali', koordinatorId
  ).lastInsertRowid;

  // Tindak pidana
  const insertTP = db.prepare('INSERT INTO tindak_pidana (jenis, pasal_kuhp) VALUES (?, ?)');
  const tp1 = insertTP.run('Pidsus Kehutanan', 'UU No. 18 Tahun 2013').lastInsertRowid;
  const tp2 = insertTP.run('Pencurian', 'Pasal 362 KUHP').lastInsertRowid;
  const tp3 = insertTP.run('Narkotika', 'UU No. 35 Tahun 2009').lastInsertRowid;

  // Kriteria - Tabel 3.4, weights as raw points (25/15/20/10/15/15), engine
  // will normalize them to fractions automatically.
  const insertK = db.prepare('INSERT INTO kriteria (nama, jenis, bobot) VALUES (?, ?, ?)');
  const c1 = insertK.run('Mengikuti Program Pembinaan', 'benefit', 25).lastInsertRowid;
  const c2 = insertK.run('Sikap', 'benefit', 15).lastInsertRowid;
  const c3 = insertK.run('Rekomendasi Tim Penilai', 'benefit', 20).lastInsertRowid;
  const c4 = insertK.run('Berkelakuan Baik', 'cost', 10).lastInsertRowid;
  const c5 = insertK.run('Patuh Aturan', 'cost', 15).lastInsertRowid;
  const c6 = insertK.run('Bebas Narkoba', 'cost', 15).lastInsertRowid;

  // Sub-kriteria (Likert mapping) - Tables 3.6 to 3.11
  const insertSK = db.prepare(
    'INSERT INTO sub_kriteria (kriteria_id, deskripsi, nilai_skala) VALUES (?, ?, ?)'
  );
  const subKriteriaSeed = [
    [c1, 'Nilai tidak baik saat mengikuti program pembinaan (10-20)', 1],
    [c1, 'Nilai kurang baik saat mengikuti program pembinaan (20-40)', 2],
    [c1, 'Nilai cukup baik saat mengikuti program pembinaan (40-60)', 3],
    [c1, 'Nilai baik saat mengikuti program pembinaan (60-80)', 4],
    [c1, 'Nilai sangat baik saat mengikuti program pembinaan (80-100)', 5],
    [c2, 'Tidak patuh dan berkelahi dengan petugas', 1],
    [c2, 'Sering melawan pegawai', 2],
    [c2, 'Sering berkelahi dengan narapidana lain', 3],
    [c2, 'Pernah mendapat hukuman disiplin 1 kali', 4],
    [c2, 'Patuh terhadap pegawai dan penjaga tahanan', 5],
    [c3, 'Tidak direkomendasikan oleh tim penilai', 1],
    [c3, 'Dipertimbangkan tim penilai', 3],
    [c3, 'Direkomendasikan oleh tim penilai', 5],
    [c4, 'Tidak pernah terdaftar melakukan pelanggaran disiplin', 1],
    [c4, 'Tidak ada pelanggaran tahun berjalan, maks. 1 kali sebelumnya', 2],
    [c4, 'Tidak ada pelanggaran tahun berjalan, 2-3 kali sebelumnya', 3],
    [c4, 'Tidak ada pelanggaran tahun berjalan, >3 kali sebelumnya', 4],
    [c4, 'Terdaftar melakukan pelanggaran disiplin tahun berjalan', 5],
    [c5, 'Tidak pernah melanggar aturan', 1],
    [c5, 'Melanggar aturan 2-5 kali dalam tahun ini', 2],
    [c5, 'Melanggar aturan 6-9 kali dalam tahun ini', 3],
    [c5, 'Melanggar aturan lebih dari 10 kali dalam tahun ini', 4],
    [c6, 'Tidak di bawah pengaruh narkoba', 1],
    [c6, 'Di bawah pengaruh narkoba', 3],
  ];
  for (const row of subKriteriaSeed) insertSK.run(...row);

  // Periode
  const insertP = db.prepare(
    `INSERT INTO periode (nama_periode, tahun, status, eligibility_mode, eligibility_value)
     VALUES (?, ?, ?, ?, ?)`
  );
  const periodeId = insertP.run('Periode 1', '2024-2025', 'draft', 'threshold', 0.5).lastInsertRowid;

  // Narapidana (sample from Tabel 3.1/3.5, assigned to waliId)
  const insertN = db.prepare(
    `INSERT INTO narapidana
      (nama, agama, tempat_lahir, tanggal_lahir, umur, alamat, pendidikan_terakhir,
       nomor_ktp, kategori_register, tindak_pidana_id, pekerjaan_semula, masa_tahanan, wali_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const narapidanaSeed = [
    ['Egidius B', 'Katolik', 'Kupang', '1998-04-12', 27, 'Kupang', 'SMA', '5301011204980001', 'B1', tp1, 'Petani', '18 bulan', waliId],
    ['Caytano L', 'Katolik', 'Kupang', '1995-02-10', 30, 'Kupang', 'SMP', '5301011002950002', 'B1', tp2, 'Buruh', '24 bulan', waliId],
    ['Rahimun H', 'Islam', 'Kupang', '1990-07-19', 34, 'Kupang', 'SD', '5301011907900003', 'B1', tp2, 'Nelayan', '30 bulan', waliId],
    ['Adrian N', 'Islam', 'Soe', '1999-05-03', 26, 'Kupang', 'SMA', '5301010305990004', 'B1', tp1, 'Sopir', '18 bulan', waliId],
    ['Mario A', 'Kristen', 'Kupang', '1992-11-23', 32, 'Kupang', 'SMP', '5301012311920005', 'B1', tp3, 'Buruh', '36 bulan', waliId],
  ];
  const narapidanaIds = narapidanaSeed.map((row) => insertN.run(...row).lastInsertRowid);

  // Penilaian - Tabel 3.5/3.12 raw scores for those 5 narapidana
  const insertPenilaian = db.prepare(
    `INSERT INTO penilaian (narapidana_id, kriteria_id, periode_id, nilai)
     VALUES (?, ?, ?, ?)`
  );
  const scores = [
    [4, 5, 3, 1, 1, 1],
    [1, 1, 1, 5, 4, 3],
    [1, 5, 1, 3, 2, 1],
    [5, 5, 3, 1, 1, 1],
    [1, 1, 1, 5, 4, 1],
  ];
  const kriteriaIds = [c1, c2, c3, c4, c5, c6];
  narapidanaIds.forEach((nId, i) => {
    kriteriaIds.forEach((kId, j) => {
      insertPenilaian.run(nId, kId, periodeId, scores[i][j]);
    });
  });

  console.log('Database seeded with default users, criteria, and sample prisoner data.');
  console.log('Default logins:');
  console.log('  kalapas          / kalapas123   (Kepala Lapas - warden)');
  console.log('  koordinatorwali  / koor123      (Koordinator Wali - coordinator)');
  console.log('  waliA            / wali123      (Wali Pemasyarakatan - guardian)');
}

seedIfEmpty();

module.exports = db;
module.exports.withTransaction = (fn) => withTransaction(db, fn);
