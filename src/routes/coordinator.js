const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { UPLOADS_DIR } = require('../utils/report');
const { hashPassword, verifyPassword } = require('../utils/password');

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
// Narapidana (prisoner) CRUD — moved here from Wali Pemasyarakatan.
// A koordinator manages narapidana for every wali under their
// coordination; a wali can only view (read-only) their own binaan.
// ---------------------------------------------------------------------
function getOwnWaliList(koordinatorId) {
  return db.prepare("SELECT * FROM users WHERE role = 'wali' AND koordinator_id = ? ORDER BY nama").all(koordinatorId);
}

function getOwnedNarapidanaByKoordinator(id, koordinatorId) {
  return db
    .prepare(
      `SELECT n.* FROM narapidana n
       JOIN users u ON u.id = n.wali_id
       WHERE n.id = ? AND u.koordinator_id = ?`
    )
    .get(id, koordinatorId);
}

router.get('/narapidana', (req, res) => {
  const koordinatorId = req.session.user.id;
  const narapidana = db
    .prepare(
      `SELECT n.*, u.nama AS wali_nama, tp.jenis AS tindak_pidana_jenis, tp.pasal_kuhp
       FROM narapidana n
       JOIN users u ON u.id = n.wali_id
       LEFT JOIN tindak_pidana tp ON tp.id = n.tindak_pidana_id
       WHERE u.koordinator_id = ? ORDER BY u.nama, n.nama`
    )
    .all(koordinatorId);
  res.render('coordinator/narapidana_list', { title: 'Data Narapidana', narapidana });
});

router.get('/narapidana/new', (req, res) => {
  const koordinatorId = req.session.user.id;
  const tindakPidana = db.prepare('SELECT * FROM tindak_pidana ORDER BY jenis').all();
  const waliList = getOwnWaliList(koordinatorId);
  res.render('coordinator/narapidana_form', {
    title: 'Tambah Narapidana',
    narapidana: null,
    tindakPidana,
    waliList,
  });
});

router.post('/narapidana/new', (req, res) => {
  const koordinatorId = req.session.user.id;
  const {
    nama, agama, tempat_lahir, tanggal_lahir, umur, alamat,
    pendidikan_terakhir, nomor_ktp, kategori_register, tindak_pidana_id,
    pekerjaan_semula, masa_tahanan, wali_id,
  } = req.body;

  if (!nama || !nama.trim()) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Nama narapidana wajib diisi.' });
  }
  const wali = wali_id
    ? db.prepare("SELECT * FROM users WHERE id = ? AND role = 'wali' AND koordinator_id = ?").get(wali_id, koordinatorId)
    : null;
  if (!wali) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Pilih Wali Pembina yang valid (harus berada di bawah koordinasi Anda).' });
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
    pekerjaan_semula || null, masa_tahanan || null, wali.id
  );

  res.redirect('/koordinator/narapidana');
});

router.get('/narapidana/:id/edit', (req, res) => {
  const koordinatorId = req.session.user.id;
  const narapidana = getOwnedNarapidanaByKoordinator(req.params.id, koordinatorId);
  if (!narapidana) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Data narapidana tidak ditemukan.' });
  }
  const tindakPidana = db.prepare('SELECT * FROM tindak_pidana ORDER BY jenis').all();
  const waliList = getOwnWaliList(koordinatorId);
  res.render('coordinator/narapidana_form', { title: 'Ubah Narapidana', narapidana, tindakPidana, waliList });
});

router.post('/narapidana/:id/edit', (req, res) => {
  const koordinatorId = req.session.user.id;
  const existing = getOwnedNarapidanaByKoordinator(req.params.id, koordinatorId);
  if (!existing) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Data narapidana tidak ditemukan.' });
  }
  const {
    nama, agama, tempat_lahir, tanggal_lahir, umur, alamat,
    pendidikan_terakhir, nomor_ktp, kategori_register, tindak_pidana_id,
    pekerjaan_semula, masa_tahanan, wali_id,
  } = req.body;

  const wali = wali_id
    ? db.prepare("SELECT * FROM users WHERE id = ? AND role = 'wali' AND koordinator_id = ?").get(wali_id, koordinatorId)
    : null;
  if (!wali) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Pilih Wali Pembina yang valid (harus berada di bawah koordinasi Anda).' });
  }

  db.prepare(
    `UPDATE narapidana SET
      nama = ?, agama = ?, tempat_lahir = ?, tanggal_lahir = ?, umur = ?, alamat = ?,
      pendidikan_terakhir = ?, nomor_ktp = ?, kategori_register = ?, tindak_pidana_id = ?,
      pekerjaan_semula = ?, masa_tahanan = ?, wali_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nama.trim(), agama || null, tempat_lahir || null, tanggal_lahir || null,
    umur ? Number(umur) : null, alamat || null, pendidikan_terakhir || null,
    nomor_ktp || null, kategori_register || null, tindak_pidana_id ? Number(tindak_pidana_id) : null,
    pekerjaan_semula || null, masa_tahanan || null, wali.id, req.params.id
  );

  res.redirect('/koordinator/narapidana');
});

router.post('/narapidana/:id/delete', (req, res) => {
  const koordinatorId = req.session.user.id;
  const existing = getOwnedNarapidanaByKoordinator(req.params.id, koordinatorId);
  if (!existing) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Data narapidana tidak ditemukan.' });
  }
  db.prepare('DELETE FROM narapidana WHERE id = ?').run(req.params.id);
  res.redirect('/koordinator/narapidana');
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

router.post('/kriteria/:id/sub-kriteria/:subId/edit', (req, res) => {
  const { deskripsi, nilai_skala } = req.body;
  db.prepare(
    "UPDATE sub_kriteria SET deskripsi = ?, nilai_skala = ?, updated_at = datetime('now') WHERE id = ? AND kriteria_id = ?"
  ).run(deskripsi.trim(), Number(nilai_skala), req.params.subId, req.params.id);
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

router.post('/tindak-pidana/:id/edit', (req, res) => {
  const { jenis, pasal_kuhp } = req.body;
  if (!jenis || !jenis.trim()) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Jenis tindak pidana wajib diisi.' });
  }
  db.prepare(
    "UPDATE tindak_pidana SET jenis = ?, pasal_kuhp = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(jenis.trim(), pasal_kuhp || null, req.params.id);
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

router.post('/periode/:id/delete', (req, res) => {
  db.prepare('DELETE FROM periode WHERE id = ?').run(req.params.id);
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

// ---------------------------------------------------------------------
// Profil Saya (view account info, change own password)
// ---------------------------------------------------------------------
router.get('/profil', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('coordinator/profil', { title: 'Profil Saya', profileUser: user, success: req.query.success, error: null });
});

router.post('/profil', (req, res) => {
  const koordinatorId = req.session.user.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(koordinatorId);
  const { nama, email, current_password, new_password, confirm_password } = req.body;

  if (nama && nama.trim()) {
    db.prepare("UPDATE users SET nama = ?, email = ?, updated_at = datetime('now') WHERE id = ?").run(
      nama.trim(), email || null, koordinatorId
    );
    req.session.user.nama = nama.trim();
  }

  if (current_password || new_password || confirm_password) {
    if (!verifyPassword(current_password || '', user.password_hash)) {
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(koordinatorId);
      return res.status(400).render('coordinator/profil', {
        title: 'Profil Saya', profileUser: refreshed, success: null, error: 'Password saat ini salah.',
      });
    }
    if (!new_password || new_password.length < 6) {
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(koordinatorId);
      return res.status(400).render('coordinator/profil', {
        title: 'Profil Saya', profileUser: refreshed, success: null, error: 'Password baru minimal 6 karakter.',
      });
    }
    if (new_password !== confirm_password) {
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(koordinatorId);
      return res.status(400).render('coordinator/profil', {
        title: 'Profil Saya', profileUser: refreshed, success: null, error: 'Konfirmasi password baru tidak cocok.',
      });
    }
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      hashPassword(new_password), koordinatorId
    );
  }

  res.redirect('/koordinator/profil?success=1');
});

module.exports = router;
