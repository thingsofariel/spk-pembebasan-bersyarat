const express = require('express');
const router = express.Router();
const { ROLE_HOME } = require('../middleware/auth');

// Public profile / landing page for LAPAS Kelas IIA Kupang.
// Logged-in users are sent straight to their dashboard; everyone else
// sees the institutional profile page with a link into /login.
router.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(ROLE_HOME[req.session.user.role] || '/login');
  }
  res.render('public/landing', { title: 'Beranda' });
});

module.exports = router;
