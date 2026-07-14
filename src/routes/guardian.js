const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calculateTopsis, applyEligibility } = require('../services/topsis');
const { writeHasilReportCsv } = require('../utils/report');

router.use(requireAuth, requireRole('wali'));

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
router.get('/dashboard', (req, res) => {
  const waliId = req.session.user.id;
  const narapidanaCount = db
    .prepare('SELECT COUNT(*) AS c FROM narapidana WHERE wali_id = ?')
    .get(waliId).c;
  const periodeList = db.prepare('SELECT * FROM periode ORDER BY id DESC').all();
  const lastHasil = db
    .prepare(
      `SELECT h.*, p.nama_periode FROM hasil_topsis h
       JOIN periode p ON p.id = h.periode_id
       WHERE h.wali_id = ? ORDER BY h.created_at DESC LIMIT 5`
    )
    .all(waliId);

  res.render('guardian/dashboard', {
    title: 'Dasbor Wali',
    narapidanaCount,
    periodeList,
    lastHasil,
  });
});

// ---------------------------------------------------------------------
// Narapidana (prisoner) CRUD - scoped to this wali
// ---------------------------------------------------------------------
router.get('/narapidana', (req, res) => {
  const waliId = req.session.user.id;
  const narapidana = db
    .prepare(
      `SELECT n.*, tp.jenis AS tindak_pidana_jenis
       FROM narapidana n
       LEFT JOIN tindak_pidana tp ON tp.id = n.tindak_pidana_id
       WHERE n.wali_id = ? ORDER BY n.nama`
    )
    .all(waliId);
  res.render('guardian/narapidana_list', { title: 'Data Narapidana', narapidana });
});

router.get('/narapidana/new', (req, res) => {
  const tindakPidana = db.prepare('SELECT * FROM tindak_pidana ORDER BY jenis').all();
  res.render('guardian/narapidana_form', {
    title: 'Tambah Narapidana',
    narapidana: null,
    tindakPidana,
  });
});

router.post('/narapidana/new', (req, res) => {
  const waliId = req.session.user.id;
  const {
    nama, agama, tempat_lahir, tanggal_lahir, umur, alamat,
    pendidikan_terakhir, nomor_ktp, kategori_register, tindak_pidana_id,
    pekerjaan_semula, masa_tahanan,
  } = req.body;

  if (!nama || !nama.trim()) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Nama narapidana wajib diisi.' });
  }

  db.prepare(
    `INSERT INTO narapidana
      (nama, agama, tempat_lahir, tanggal_lahir, umur, alamat, pendidikan_terakhir,
       nomor_ktp, kategori_register, tindak_pidana_id, pekerjaan_semula, masa_tahanan, wali_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nama.trim(), agama || null, tempat_lahir || null, tanggal_lahir || null,
    umur ? Number(umur) : null, alamat || null, pendidikan_terakhir || null,
    nomor_ktp || null, kategori_register || null, tindak_pidana_id ? Number(tindak_pidana_id) : null,
    pekerjaan_semula || null, masa_tahanan || null, waliId
  );

  res.redirect('/wali/narapidana');
});

function getOwnedNarapidana(id, waliId) {
  return db.prepare('SELECT * FROM narapidana WHERE id = ? AND wali_id = ?').get(id, waliId);
}

router.get('/narapidana/:id/edit', (req, res) => {
  const waliId = req.session.user.id;
  const narapidana = getOwnedNarapidana(req.params.id, waliId);
  if (!narapidana) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Data narapidana tidak ditemukan.' });
  }
  const tindakPidana = db.prepare('SELECT * FROM tindak_pidana ORDER BY jenis').all();
  res.render('guardian/narapidana_form', { title: 'Ubah Narapidana', narapidana, tindakPidana });
});

router.post('/narapidana/:id/edit', (req, res) => {
  const waliId = req.session.user.id;
  const existing = getOwnedNarapidana(req.params.id, waliId);
  if (!existing) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Data narapidana tidak ditemukan.' });
  }
  const {
    nama, agama, tempat_lahir, tanggal_lahir, umur, alamat,
    pendidikan_terakhir, nomor_ktp, kategori_register, tindak_pidana_id,
    pekerjaan_semula, masa_tahanan,
  } = req.body;

  db.prepare(
    `UPDATE narapidana SET
      nama = ?, agama = ?, tempat_lahir = ?, tanggal_lahir = ?, umur = ?, alamat = ?,
      pendidikan_terakhir = ?, nomor_ktp = ?, kategori_register = ?, tindak_pidana_id = ?,
      pekerjaan_semula = ?, masa_tahanan = ?, updated_at = datetime('now')
     WHERE id = ? AND wali_id = ?`
  ).run(
    nama.trim(), agama || null, tempat_lahir || null, tanggal_lahir || null,
    umur ? Number(umur) : null, alamat || null, pendidikan_terakhir || null,
    nomor_ktp || null, kategori_register || null, tindak_pidana_id ? Number(tindak_pidana_id) : null,
    pekerjaan_semula || null, masa_tahanan || null, req.params.id, waliId
  );

  res.redirect('/wali/narapidana');
});

router.post('/narapidana/:id/delete', (req, res) => {
  const waliId = req.session.user.id;
  db.prepare('DELETE FROM narapidana WHERE id = ? AND wali_id = ?').run(req.params.id, waliId);
  res.redirect('/wali/narapidana');
});

// ---------------------------------------------------------------------
// Penilaian (scoring) - grid of narapidana x kriteria, choosing a
// sub-kriteria per cell, for a chosen periode.
// ---------------------------------------------------------------------
router.get('/penilaian', (req, res) => {
  const waliId = req.session.user.id;
  const periodeList = db.prepare('SELECT * FROM periode ORDER BY id DESC').all();
  if (periodeList.length === 0) {
    return res.render('guardian/penilaian', {
      title: 'Penilaian Kriteria',
      periodeList, periode: null, narapidana: [], kriteria: [], subKriteriaByKriteria: {}, existingScores: {},
    });
  }
  const periodeId = Number(req.query.periode_id) || periodeList[0].id;
  const periode = db.prepare('SELECT * FROM periode WHERE id = ?').get(periodeId);

  const narapidana = db.prepare('SELECT * FROM narapidana WHERE wali_id = ? ORDER BY nama').all(waliId);
  const kriteria = db.prepare('SELECT * FROM kriteria ORDER BY id').all();

  const subKriteriaByKriteria = {};
  for (const k of kriteria) {
    subKriteriaByKriteria[k.id] = db
      .prepare('SELECT * FROM sub_kriteria WHERE kriteria_id = ? ORDER BY nilai_skala')
      .all(k.id);
  }

  const existingRows = db
    .prepare(
      `SELECT p.narapidana_id, p.kriteria_id, p.sub_kriteria_id, p.nilai
       FROM penilaian p
       JOIN narapidana n ON n.id = p.narapidana_id
       WHERE n.wali_id = ? AND p.periode_id = ?`
    )
    .all(waliId, periodeId);
  const existingScores = {};
  for (const row of existingRows) {
    existingScores[`${row.narapidana_id}_${row.kriteria_id}`] = row.sub_kriteria_id;
  }

  res.render('guardian/penilaian', {
    title: 'Penilaian Kriteria',
    periodeList, periode, narapidana, kriteria, subKriteriaByKriteria, existingScores,
  });
});

router.post('/penilaian', (req, res) => {
  const waliId = req.session.user.id;
  const periodeId = Number(req.body.periode_id);
  if (!periodeId) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Periode wajib dipilih.' });
  }

  // Only allow scoring for narapidana owned by this wali.
  const ownedIds = new Set(
    db.prepare('SELECT id FROM narapidana WHERE wali_id = ?').all(waliId).map((r) => r.id)
  );
  const kriteriaList = db.prepare('SELECT * FROM kriteria').all();

  const upsert = db.prepare(
    `INSERT INTO penilaian (narapidana_id, kriteria_id, sub_kriteria_id, periode_id, nilai)
     VALUES (@narapidana_id, @kriteria_id, @sub_kriteria_id, @periode_id, @nilai)
     ON CONFLICT(narapidana_id, kriteria_id, periode_id)
     DO UPDATE SET sub_kriteria_id = @sub_kriteria_id, nilai = @nilai, updated_at = datetime('now')`
  );

  const scores = req.body.scores || {}; // scores[narapidanaId][kriteriaId] = subKriteriaId
  db.withTransaction(() => {
    for (const [narapidanaId, byKriteria] of Object.entries(scores)) {
      if (!ownedIds.has(Number(narapidanaId))) continue;
      for (const [kriteriaId, subKriteriaId] of Object.entries(byKriteria)) {
        if (!subKriteriaId) continue;
        const sub = db.prepare('SELECT * FROM sub_kriteria WHERE id = ?').get(subKriteriaId);
        if (!sub || sub.kriteria_id !== Number(kriteriaId)) continue;
        upsert.run({
          narapidana_id: Number(narapidanaId),
          kriteria_id: Number(kriteriaId),
          sub_kriteria_id: Number(subKriteriaId),
          periode_id: periodeId,
          nilai: sub.nilai_skala,
        });
      }
    }
  });

  res.redirect(`/wali/penilaian?periode_id=${periodeId}`);
});

// ---------------------------------------------------------------------
// Perhitungan (TOPSIS calculation)
// ---------------------------------------------------------------------
function loadCalculationInputs(waliId, periodeId) {
  const narapidana = db.prepare('SELECT * FROM narapidana WHERE wali_id = ? ORDER BY nama').all(waliId);
  const kriteria = db.prepare('SELECT * FROM kriteria ORDER BY id').all();

  const alternatives = [];
  const incomplete = [];
  for (const n of narapidana) {
    const rows = db
      .prepare('SELECT kriteria_id, nilai FROM penilaian WHERE narapidana_id = ? AND periode_id = ?')
      .all(n.id, periodeId);
    const scores = {};
    for (const r of rows) scores[r.kriteria_id] = r.nilai;
    const hasAll = kriteria.every((k) => typeof scores[k.id] === 'number');
    if (!hasAll) {
      incomplete.push(n);
      continue;
    }
    alternatives.push({ id: n.id, name: n.nama, scores });
  }

  const criteria = kriteria.map((k) => ({ id: k.id, name: k.nama, type: k.jenis, weight: k.bobot }));
  return { alternatives, criteria, incomplete };
}

router.get('/perhitungan', (req, res) => {
  const waliId = req.session.user.id;
  const periodeList = db.prepare('SELECT * FROM periode ORDER BY id DESC').all();
  if (periodeList.length === 0) {
    return res.render('guardian/perhitungan', {
      title: 'Perhitungan TOPSIS', periodeList, periode: null, calc: null, incomplete: [], savedResults: [],
    });
  }
  const periodeId = Number(req.query.periode_id) || periodeList[0].id;
  const periode = db.prepare('SELECT * FROM periode WHERE id = ?').get(periodeId);

  const { alternatives, criteria, incomplete } = loadCalculationInputs(waliId, periodeId);

  let calc = null;
  if (alternatives.length > 0) {
    try {
      calc = calculateTopsis(alternatives, criteria);
      calc.results = applyEligibility(calc.results, {
        mode: periode.eligibility_mode,
        value: periode.eligibility_value,
      });
    } catch (e) {
      calc = { error: e.message };
    }
  }

  const savedResults = db
    .prepare(
      `SELECT h.*, n.nama FROM hasil_topsis h
       JOIN narapidana n ON n.id = h.narapidana_id
       WHERE h.wali_id = ? AND h.periode_id = ? ORDER BY h.peringkat`
    )
    .all(waliId, periodeId);

  res.render('guardian/perhitungan', {
    title: 'Perhitungan TOPSIS', periodeList, periode, calc, incomplete, alternatives, criteria, savedResults,
    sent: req.query.sent,
  });
});

router.post('/perhitungan', (req, res) => {
  const waliId = req.session.user.id;
  const periodeId = Number(req.body.periode_id);
  const periode = db.prepare('SELECT * FROM periode WHERE id = ?').get(periodeId);
  if (!periode) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Periode tidak ditemukan.' });
  }

  const { alternatives, criteria, incomplete } = loadCalculationInputs(waliId, periodeId);
  if (alternatives.length === 0) {
    return res.redirect(`/wali/perhitungan?periode_id=${periodeId}`);
  }

  const calc = calculateTopsis(alternatives, criteria);
  const results = applyEligibility(calc.results, {
    mode: periode.eligibility_mode,
    value: periode.eligibility_value,
  });

  const del = db.prepare('DELETE FROM hasil_topsis WHERE wali_id = ? AND periode_id = ?');
  const ins = db.prepare(
    `INSERT INTO hasil_topsis (periode_id, narapidana_id, wali_id, nilai_preferensi, peringkat, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  db.withTransaction(() => {
    del.run(waliId, periodeId);
    for (const r of results) {
      ins.run(periodeId, r.alternativeId, waliId, r.score, r.rank, r.status);
    }
    db.prepare("UPDATE periode SET status = 'dihitung' WHERE id = ?").run(periodeId);
  });

  res.redirect(`/wali/perhitungan?periode_id=${periodeId}`);
});

// ---------------------------------------------------------------------
// Kirim laporan (submit report to coordinator)
// ---------------------------------------------------------------------
router.post('/laporan/kirim', (req, res) => {
  const waliId = req.session.user.id;
  const periodeId = Number(req.body.periode_id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(waliId);
  const periode = db.prepare('SELECT * FROM periode WHERE id = ?').get(periodeId);

  if (!user.koordinator_id) {
    return res.status(400).render('error', {
      title: 'Tidak Dapat Mengirim',
      message: 'Akun Anda belum terhubung ke Koordinator Wali. Hubungi administrator.',
    });
  }

  const rows = db
    .prepare(
      `SELECT h.*, n.nama FROM hasil_topsis h
       JOIN narapidana n ON n.id = h.narapidana_id
       WHERE h.wali_id = ? AND h.periode_id = ? ORDER BY h.peringkat`
    )
    .all(waliId, periodeId);

  if (rows.length === 0) {
    return res.status(400).render('error', {
      title: 'Belum Ada Hasil',
      message: 'Lakukan perhitungan TOPSIS terlebih dahulu sebelum mengirim laporan.',
    });
  }

  const { fileName, filePath } = writeHasilReportCsv({
    periodeNama: periode.nama_periode,
    waliNama: user.nama,
    rows,
  });

  db.prepare(
    `INSERT INTO distribusi_file (judul, deskripsi, file_path, periode_id, dari_user_id, ke_user_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'terkirim')`
  ).run(
    `Laporan Hasil TOPSIS - ${periode.nama_periode}`,
    `Laporan hasil perhitungan TOPSIS oleh ${user.nama} untuk periode ${periode.nama_periode}.`,
    fileName, periodeId, waliId, user.koordinator_id
  );

  res.redirect(`/wali/perhitungan?periode_id=${periodeId}&sent=1`);
});

module.exports = router;
