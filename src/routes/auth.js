const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyPassword } = require('../utils/password');
const { ROLE_HOME } = require('../middleware/auth');

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(ROLE_HOME[req.session.user.role] || '/login');
  }
  res.render('auth/login', { title: 'Masuk', error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).render('auth/login', {
      title: 'Masuk',
      error: 'Username dan password wajib diisi.',
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).render('auth/login', {
      title: 'Masuk',
      error: 'Username atau password salah.',
    });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).render('auth/login', {
        title: 'Masuk',
        error: 'Terjadi kesalahan sistem. Coba lagi.',
      });
    }
    req.session.user = {
      id: user.id,
      nama: user.nama,
      username: user.username,
      role: user.role,
      koordinator_id: user.koordinator_id,
      foto_profil: user.foto_profil,
    };
    res.redirect(ROLE_HOME[user.role] || '/login');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
