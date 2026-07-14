const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { UPLOADS_DIR } = require('../utils/report');

router.use(requireAuth, requireRole('koordinator_wali'));

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
router.get('/dashboard', (req, res) => {
  const koordinatorId = req.session.user.id;
  const waliCount = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'wali' AND koordinator_id = ?")
    .get(koordinatorId).c;
  const narapidanaCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM narapidana n
       JOIN users u ON u.id = n.wali_id
       WHERE u.koordinator_id = ?`
    )
    .get(koordinatorId).c;
  const pendingReports = db
    .prepare("SELECT COUNT(*) AS c FROM distribusi_file WHERE ke_user_id = ? AND status = 'terkirim'")
    .get(koordinatorId).c;

  res.render('coordinator/dashboard', { title: 'Dasbor Koordinator', waliCount, narapidanaCount, pendingReports });
});

// ---------------------------------------------------------------------
// Monitor narapidana across all wali under this coordinator
// ---------------------------------------------------------------------
router.get('/narapidana', (req, res) => {
  const koordinatorId = req.session.user.id;
  const narapidana = db
    .prepare(
      `SELECT n.*, u.nama AS wali_nama, tp.jenis AS tindak_pidana_jenis
       FROM narapidana n
       JOIN users u ON u.id = n.wali_id
       LEFT JOIN tindak_pidana tp ON tp.id = n.tindak_pidana_id
       WHERE u.koordinator_id = ? ORDER BY u.nama, n.nama`
    )
    .all(koordinatorId);
  res.render('coordinator/narapidana_list', { title: 'Monitor Narapidana', narapidana });
});

// ---------------------------------------------------------------------
// Kriteria CRUD
// ---------------------------------------------------------------------
router.get('/kriteria', (req, res) => {
  const kriteria = db.prepare('SELECT * FROM kriteria ORDER BY id').all();
  const totalBobot = kriteria.reduce((s, k) => s + k.bobot, 0);
  res.render('coordinator/kriteria_list', { title: 'Kriteria Penilaian', kriteria, totalBobot });
});

router.get('/kriteria/new', (req, res) => {
  res.render('coordinator/kriteria_form', { title: 'Tambah Kriteria', kriteria: null });
});

router.post('/kriteria/new', (req, res) => {
  const { nama, jenis, bobot } = req.body;
  if (!nama || !['benefit', 'cost'].includes(jenis) || Number.isNaN(Number(bobot))) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Periksa kembali nama, jenis, dan bobot kriteria.' });
  }
  db.prepare('INSERT INTO kriteria (nama, jenis, bobot) VALUES (?, ?, ?)').run(nama.trim(), jenis, Number(bobot));
  res.redirect('/koordinator/kriteria');
});

router.get('/kriteria/:id/edit', (req, res) => {
  const kriteria = db.prepare('SELECT * FROM kriteria WHERE id = ?').get(req.params.id);
  if (!kriteria) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Kriteria tidak ditemukan.' });
  const subKriteria = db.prepare('SELECT * FROM sub_kriteria WHERE kriteria_id = ? ORDER BY nilai_skala').all(kriteria.id);
  res.render('coordinator/kriteria_form', { title: 'Ubah Kriteria', kriteria, subKriteria });
});

router.post('/kriteria/:id/edit', (req, res) => {
  const { nama, jenis, bobot } = req.body;
  db.prepare(
    "UPDATE kriteria SET nama = ?, jenis = ?, bobot = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(nama.trim(), jenis, Number(bobot), req.params.id);
  res.redirect('/koordinator/kriteria');
});

router.post('/kriteria/:id/delete', (req, res) => {
  db.prepare('DELETE FROM kriteria WHERE id = ?').run(req.params.id);
  res.redirect('/koordinator/kriteria');
});

// Sub-kriteria (Likert scale mapping) for a given kriteria
router.post('/kriteria/:id/sub-kriteria/new', (req, res) => {
  const { deskripsi, nilai_skala } = req.body;
  db.prepare('INSERT INTO sub_kriteria (kriteria_id, deskripsi, nilai_skala) VALUES (?, ?, ?)').run(
    req.params.id, deskripsi.trim(), Number(nilai_skala)
  );
  res.redirect(`/koordinator/kriteria/${req.params.id}/edit`);
});

router.post('/kriteria/:id/sub-kriteria/:subId/delete', (req, res) => {
  db.prepare('DELETE FROM sub_kriteria WHERE id = ? AND kriteria_id = ?').run(req.params.subId, req.params.id);
  res.redirect(`/koordinator/kriteria/${req.params.id}/edit`);
});

// ---------------------------------------------------------------------
// Tindak Pidana CRUD
// ---------------------------------------------------------------------
router.get('/tindak-pidana', (req, res) => {
  const tindakPidana = db.prepare('SELECT * FROM tindak_pidana ORDER BY jenis').all();
  res.render('coordinator/tindak_pidana_list', { title: 'Tindak Pidana', tindakPidana });
});

router.post('/tindak-pidana/new', (req, res) => {
  const { jenis, pasal_kuhp } = req.body;
  db.prepare('INSERT INTO tindak_pidana (jenis, pasal_kuhp) VALUES (?, ?)').run(jenis.trim(), pasal_kuhp || null);
  res.redirect('/koordinator/tindak-pidana');
});

router.post('/tindak-pidana/:id/delete', (req, res) => {
  db.prepare('DELETE FROM tindak_pidana WHERE id = ?').run(req.params.id);
  res.redirect('/koordinator/tindak-pidana');
});

// ---------------------------------------------------------------------
// Periode CRUD
// ---------------------------------------------------------------------
router.get('/periode', (req, res) => {
  const periode = db.prepare('SELECT * FROM periode ORDER BY id DESC').all();
  res.render('coordinator/periode_list', { title: 'Periode Penilaian', periode });
});

router.get('/periode/new', (req, res) => {
  res.render('coordinator/periode_form', { title: 'Tambah Periode', periode: null });
});

router.post('/periode/new', (req, res) => {
  const { nama_periode, tahun, eligibility_mode, eligibility_value } = req.body;
  db.prepare(
    `INSERT INTO periode (nama_periode, tahun, eligibility_mode, eligibility_value)
     VALUES (?, ?, ?, ?)`
  ).run(nama_periode.trim(), tahun.trim(), eligibility_mode, Number(eligibility_value));
  res.redirect('/koordinator/periode');
});

router.get('/periode/:id/edit', (req, res) => {
  const periode = db.prepare('SELECT * FROM periode WHERE id = ?').get(req.params.id);
  if (!periode) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Periode tidak ditemukan.' });
  res.render('coordinator/periode_form', { title: 'Ubah Periode', periode });
});

router.post('/periode/:id/edit', (req, res) => {
  const { nama_periode, tahun, status, eligibility_mode, eligibility_value } = req.body;
  db.prepare(
    `UPDATE periode SET nama_periode = ?, tahun = ?, status = ?, eligibility_mode = ?,
     eligibility_value = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(nama_periode.trim(), tahun.trim(), status, eligibility_mode, Number(eligibility_value), req.params.id);
  res.redirect('/koordinator/periode');
});

// ---------------------------------------------------------------------
// Laporan: receive from wali, forward to warden
// ---------------------------------------------------------------------
router.get('/laporan', (req, res) => {
  const koordinatorId = req.session.user.id;
  const diterima = db
    .prepare(
      `SELECT d.*, u.nama AS dari_nama, p.nama_periode
       FROM distribusi_file d
       JOIN users u ON u.id = d.dari_user_id
       LEFT JOIN periode p ON p.id = d.periode_id
       WHERE d.ke_user_id = ? ORDER BY d.created_at DESC`
    )
    .all(koordinatorId);
  const diteruskan = db
    .prepare(
      `SELECT d.*, u.nama AS ke_nama, p.nama_periode
       FROM distribusi_file d
       JOIN users u ON u.id = d.ke_user_id
       LEFT JOIN periode p ON p.id = d.periode_id
       WHERE d.dari_user_id = ? ORDER BY d.created_at DESC`
    )
    .all(koordinatorId);
  res.render('coordinator/laporan_list', { title: 'Laporan', diterima, diteruskan });
});

router.post('/laporan/:id/terima', (req, res) => {
  const koordinatorId = req.session.user.id;
  db.prepare("UPDATE distribusi_file SET status = 'diterima' WHERE id = ? AND ke_user_id = ?").run(
    req.params.id, koordinatorId
  );
  res.redirect('/koordinator/laporan');
});

router.post('/laporan/:id/teruskan', (req, res) => {
  const koordinatorId = req.session.user.id;
  const original = db
    .prepare('SELECT * FROM distribusi_file WHERE id = ? AND ke_user_id = ?')
    .get(req.params.id, koordinatorId);
  if (!original) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Laporan tidak ditemukan.' });
  }
  const warden = db.prepare("SELECT * FROM users WHERE role = 'kepala_lapas' LIMIT 1").get();
  if (!warden) {
    return res.status(400).render('error', { title: 'Tidak Dapat Meneruskan', message: 'Akun Kepala Lapas belum terdaftar.' });
  }
  db.prepare(
    `INSERT INTO distribusi_file (judul, deskripsi, file_path, periode_id, dari_user_id, ke_user_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'terkirim')`
  ).run(
    `[Diteruskan] ${original.judul}`,
    `Diteruskan oleh Koordinator dari laporan wali. ${original.deskripsi || ''}`,
    original.file_path, original.periode_id, koordinatorId, warden.id
  );
  db.prepare("UPDATE distribusi_file SET status = 'diterima' WHERE id = ?").run(original.id);
  res.redirect('/koordinator/laporan');
});

router.get('/laporan/:id/unduh', (req, res) => {
  const koordinatorId = req.session.user.id;
  const file = db
    .prepare(
      'SELECT * FROM distribusi_file WHERE id = ? AND (ke_user_id = ? OR dari_user_id = ?)'
    )
    .get(req.params.id, koordinatorId, koordinatorId);
  if (!file) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'File tidak ditemukan.' });
  res.download(path.join(UPLOADS_DIR, file.file_path));
});

module.exports = router;
