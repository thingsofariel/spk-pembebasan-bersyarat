const crypto = require('crypto');

/**
 * Minimal CSRF protection without an external package:
 * - GET requests: ensure a token exists in the session, expose it to views.
 * - POST requests: require the submitted _csrf field to match the session token.
 */
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'POST') {
    // multipart/form-data bodies (file uploads) aren't parsed by
    // express.urlencoded(), so req.body._csrf isn't available yet at this
    // point in the pipeline. Those routes validate CSRF themselves, after
    // multer has parsed the form fields — see middleware/upload.js.
    if (req.is('multipart/form-data')) {
      return next();
    }
    const submitted = req.body && req.body._csrf;
    if (!submitted || submitted !== req.session.csrfToken) {
      return res.status(403).render('error', {
        title: 'Permintaan Ditolak',
        message: 'Token keamanan tidak valid atau sudah kedaluwarsa. Silakan muat ulang halaman dan coba lagi.',
      });
    }
  }
  next();
}

module.exports = csrfProtection;
