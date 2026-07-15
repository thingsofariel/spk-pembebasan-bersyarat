const express = require('express');
const session = require('express-session');
const path = require('path');

const csrfProtection = require('./middleware/csrf');
const { ROLE_HOME, ROLE_LABEL } = require('./middleware/auth');
const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const wardenRoutes = require('./routes/warden');
const coordinatorRoutes = require('./routes/coordinator');
const guardianRoutes = require('./routes/guardian');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    name: 'parole_dss.sid',
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

app.use(csrfProtection);

// Make role helpers + current user available in every view
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.ROLE_LABEL = ROLE_LABEL;
  res.locals.currentPath = req.path;
  next();
});

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/warden', wardenRoutes);
app.use('/koordinator', coordinatorRoutes);
app.use('/wali', guardianRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Halaman Tidak Ditemukan', message: `Tidak ada halaman untuk ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Kesalahan Server',
    message: process.env.NODE_ENV === 'production' ? 'Terjadi kesalahan pada server.' : err.message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sistem Pendukung Keputusan Pembebasan Bersyarat berjalan di http://localhost:${PORT}`);
});

module.exports = app;
