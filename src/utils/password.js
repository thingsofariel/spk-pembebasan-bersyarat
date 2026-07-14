/**
 * Password hashing using Node's built-in crypto.scrypt.
 * Deliberately avoids bcrypt/bcryptjs so the project has zero native
 * dependencies to compile and one less package to install.
 *
 * Stored format: scrypt$<saltHex>$<hashHex>
 */
const crypto = require('crypto');

const KEY_LEN = 64;

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plainPassword, salt, KEY_LEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plainPassword, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const candidate = crypto.scryptSync(plainPassword, salt, KEY_LEN);
  const stored_ = Buffer.from(hashHex, 'hex');
  if (candidate.length !== stored_.length) return false;
  return crypto.timingSafeEqual(candidate, stored_);
}

module.exports = { hashPassword, verifyPassword };
