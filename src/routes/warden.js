const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/password');
const { UPLOADS_DIR } = require('../utils/report');

router.use(requireAuth, requireRole('kepala_lapas'));

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
router.get('/dashboard', (req, res) => {
  const narapidanaCount = db.prepare('SELECT COUNT(*) AS c FROM narapidana').get().c;
  const waliCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'wali'").get().c;
  const koordinatorCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'koordinator_wali'").get().c;
  const pendingReports = db
    .prepare("SELECT COUNT(*) AS c FROM distribusi_file WHERE ke_user_id = ? AND status = 'terkirim'")
    .get(req.session.user.id).c;

  res.render('warden/dashboard', {
    title: 'Dasbor Kepala Lapas',
    narapidanaCount, waliCount, koordinatorCount, pendingReports,
  });
});

// ---------------------------------------------------------------------
// Monitor all narapidana across the whole prison
// ---------------------------------------------------------------------
router.get('/narapidana', (req, res) => {
  const narapidana = db
    .prepare(
      `SELECT n.*, u.nama AS wali_nama, tp.jenis AS tindak_pidana_jenis, tp.pasal_kuhp
       FROM narapidana n
       LEFT JOIN users u ON u.id = n.wali_id
       LEFT JOIN tindak_pidana tp ON tp.id = n.tindak_pidana_id
       ORDER BY u.nama, n.nama`
    )
    .all();
  res.render('warden/narapidana_list', { title: 'Monitor Seluruh Narapidana', narapidana });
});

// ---------------------------------------------------------------------
// User management (create koordinator & wali accounts)
// ---------------------------------------------------------------------
router.get('/users', (req, res) => {
  const users = db
    .prepare(
      `SELECT u.*, k.nama AS koordinator_nama FROM users u
       LEFT JOIN users k ON k.id = u.koordinator_id
       ORDER BY u.role, u.nama`
    )
    .all();
  res.render('warden/users_list', { title: 'Manajemen Pengguna', users });
});

router.get('/users/new', (req, res) => {
  const koordinatorList = db.prepare("SELECT * FROM users WHERE role = 'koordinator_wali' ORDER BY nama").all();
  res.render('warden/users_form', { title: 'Tambah Pengguna', koordinatorList, user: null });
});

router.post('/users/new', (req, res) => {
  const { nama, username, password, email, role, koordinator_id } = req.body;

  if (!nama || !username || !password || !role) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Nama, username, password, dan peran wajib diisi.' });
  }
  if (!['kepala_lapas', 'koordinator_wali', 'wali'].includes(role)) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Peran tidak valid.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Username sudah digunakan.' });
  }

  db.prepare(
    `INSERT INTO users (nama, username, password_hash, email, role, koordinator_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    nama.trim(), username.trim(), hashPassword(password), email || null, role,
    role === 'wali' && koordinator_id ? Number(koordinator_id) : null
  );

  res.redirect('/warden/users');
});

router.get('/users/:id/edit', (req, res) => {
  const editUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Pengguna tidak ditemukan.' });
  const koordinatorList = db.prepare("SELECT * FROM users WHERE role = 'koordinator_wali' ORDER BY nama").all();
  res.render('warden/users_form', { title: 'Ubah Pengguna', user: editUser, koordinatorList });
});

router.post('/users/:id/edit', (req, res) => {
  const targetId = Number(req.params.id);
  const editUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!editUser) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Pengguna tidak ditemukan.' });

  const { nama, email, role, koordinator_id, password } = req.body;
  if (!nama || !nama.trim()) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Nama wajib diisi.' });
  }
  // Guard: an account can't change its own role (avoids accidental self-lockout
  // from the only kepala_lapas account, or losing warden access mid-session).
  const isSelf = targetId === req.session.user.id;
  const finalRole = isSelf ? editUser.role : role;
  if (!['kepala_lapas', 'koordinator_wali', 'wali'].includes(finalRole)) {
    return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Peran tidak valid.' });
  }

  db.prepare(
    `UPDATE users SET nama = ?, email = ?, role = ?, koordinator_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    nama.trim(), email || null, finalRole,
    finalRole === 'wali' && koordinator_id ? Number(koordinator_id) : null,
    targetId
  );

  if (password && password.trim()) {
    if (password.length < 6) {
      return res.status(400).render('error', { title: 'Data Tidak Valid', message: 'Password baru minimal 6 karakter.' });
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), targetId);
  }

  if (isSelf) {
    req.session.user.nama = nama.trim();
  }

  res.redirect('/warden/users');
});

router.post('/users/:id/delete', (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).render('error', { title: 'Tidak Diizinkan', message: 'Anda tidak dapat menghapus akun Anda sendiri.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.redirect('/warden/users');
});

// ---------------------------------------------------------------------
// Laporan (reports forwarded from coordinator)
// ---------------------------------------------------------------------
router.get('/laporan', (req, res) => {
  const wardenId = req.session.user.id;
  const laporan = db
    .prepare(
      `SELECT d.*, u.nama AS dari_nama, p.nama_periode
       FROM distribusi_file d
       JOIN users u ON u.id = d.dari_user_id
       LEFT JOIN periode p ON p.id = d.periode_id
       WHERE d.ke_user_id = ? ORDER BY d.created_at DESC`
    )
    .all(wardenId);
  res.render('warden/laporan_list', { title: 'Laporan Masuk', laporan });
});

router.post('/laporan/:id/terima', (req, res) => {
  const wardenId = req.session.user.id;
  db.prepare("UPDATE distribusi_file SET status = 'diterima' WHERE id = ? AND ke_user_id = ?").run(
    req.params.id, wardenId
  );
  res.redirect('/warden/laporan');
});

router.get('/laporan/:id/unduh', (req, res) => {
  const wardenId = req.session.user.id;
  const file = db.prepare('SELECT * FROM distribusi_file WHERE id = ? AND ke_user_id = ?').get(req.params.id, wardenId);
  if (!file) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'File tidak ditemukan.' });
  res.download(path.join(UPLOADS_DIR, file.file_path));
});

// ---------------------------------------------------------------------
// Profil Saya (view account info, change own password)
// ---------------------------------------------------------------------
router.get('/profil', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('warden/profil', { title: 'Profil Saya', profileUser: user, success: req.query.success, error: null });
});

router.post('/profil', (req, res) => {
  const wardenId = req.session.user.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(wardenId);
  const { nama, email, current_password, new_password, confirm_password } = req.body;

  if (nama && nama.trim()) {
    db.prepare("UPDATE users SET nama = ?, email = ?, updated_at = datetime('now') WHERE id = ?").run(
      nama.trim(), email || null, wardenId
    );
    req.session.user.nama = nama.trim();
  }

  if (current_password || new_password || confirm_password) {
    if (!verifyPassword(current_password || '', user.password_hash)) {
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(wardenId);
      return res.status(400).render('warden/profil', {
        title: 'Profil Saya', profileUser: refreshed, success: null, error: 'Password saat ini salah.',
      });
    }
    if (!new_password || new_password.length < 6) {
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(wardenId);
      return res.status(400).render('warden/profil', {
        title: 'Profil Saya', profileUser: refreshed, success: null, error: 'Password baru minimal 6 karakter.',
      });
    }
    if (new_password !== confirm_password) {
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(wardenId);
      return res.status(400).render('warden/profil', {
        title: 'Profil Saya', profileUser: refreshed, success: null, error: 'Konfirmasi password baru tidak cocok.',
      });
    }
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      hashPassword(new_password), wardenId
    );
  }

  res.redirect('/warden/profil?success=1');
});

module.exports = router;
