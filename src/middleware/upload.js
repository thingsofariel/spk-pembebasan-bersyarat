const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Stored under public/images so express.static() can serve it directly,
// deliberately separate from /uploads (which holds laporan CSVs that are
// only ever served through an authenticated download route).
const PROFILE_PHOTOS_DIR = path.join(__dirname, '..', '..', 'public', 'images', 'profile-photos');
fs.mkdirSync(PROFILE_PHOTOS_DIR, { recursive: true });

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB, per Fortuna's spec

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROFILE_PHOTOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const userId = req.session && req.session.user ? req.session.user.id : 'anon';
    cb(null, `user-${userId}-${Date.now()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const allowedExt = ['.jpg', '.jpeg'];
  const allowedMime = ['image/jpeg'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExt.includes(ext) || !allowedMime.includes(file.mimetype)) {
    return cb(new Error('FILE_TYPE'));
  }
  cb(null, true);
}

const uploadProfilePhoto = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_BYTES },
}).single('foto');

/**
 * Wraps multer's callback-style middleware so upload errors (wrong type,
 * too large) redirect back to the profile page with a friendly Indonesian
 * message instead of hitting the generic Express error page.
 */
function handleProfilePhotoUpload(redirectPath) {
  return (req, res, next) => {
    uploadProfilePhoto(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.redirect(`${redirectPath}?photoError=${encodeURIComponent('Ukuran foto maksimal 10 MB.')}`);
        }
        return res.redirect(`${redirectPath}?photoError=${encodeURIComponent('Gagal mengunggah foto.')}`);
      }
      if (err && err.message === 'FILE_TYPE') {
        return res.redirect(`${redirectPath}?photoError=${encodeURIComponent('Format foto harus JPG atau JPEG.')}`);
      }
      if (err) {
        return res.redirect(`${redirectPath}?photoError=${encodeURIComponent('Gagal mengunggah foto.')}`);
      }
      // CSRF check deferred from the global middleware (see middleware/csrf.js)
      // since req.body only exists now that multer has parsed the form.
      const submitted = req.body && req.body._csrf;
      if (!submitted || submitted !== req.session.csrfToken) {
        // multer already wrote the file to disk before we got here — clean
        // it up so a rejected request doesn't leave an orphaned file.
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).render('error', {
          title: 'Permintaan Ditolak',
          message: 'Token keamanan tidak valid atau sudah kedaluwarsa. Silakan muat ulang halaman dan coba lagi.',
        });
      }
      next();
    });
  };
}

function deleteOldPhoto(fotoProfil) {
  if (!fotoProfil) return;
  const filePath = path.join(PROFILE_PHOTOS_DIR, path.basename(fotoProfil));
  fs.unlink(filePath, () => {}); // best-effort, ignore errors
}

module.exports = { handleProfilePhotoUpload, deleteOldPhoto, PROFILE_PHOTOS_DIR };
