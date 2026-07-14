/**
 * requireAuth: blocks access unless a session user is present.
 * requireRole: blocks access unless the session user's role is in the
 * allowed list. Use after requireAuth.
 *
 * Roles:
 *   'kepala_lapas'      - Level 0 - Prison Warden
 *   'koordinator_wali'  - Level 1 - Guardian Coordinator
 *   'wali'              - Level 2 - Guardian
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki izin untuk mengakses halaman ini.',
      });
    }
    next();
  };
}

const ROLE_HOME = {
  kepala_lapas: '/warden/dashboard',
  koordinator_wali: '/koordinator/dashboard',
  wali: '/wali/dashboard',
};

const ROLE_LABEL = {
  kepala_lapas: 'Kepala Lapas',
  koordinator_wali: 'Koordinator Wali Pemasyarakatan',
  wali: 'Wali Pemasyarakatan',
};

module.exports = { requireAuth, requireRole, ROLE_HOME, ROLE_LABEL };
