process.env.DB_PATH = '/tmp/parole_dss_test.sqlite';
const fs = require('fs');
if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);

const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'config', 'db'));
const { hashPassword, verifyPassword } = require(path.join(__dirname, '..', 'src', 'utils', 'password'));

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  OK  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}`); }
}

console.log('\n== 1. Seed data sanity ==');
const koordinator = db.prepare("SELECT * FROM users WHERE username = 'koordinatorwali'").get();
const waliA = db.prepare("SELECT * FROM users WHERE username = 'waliA'").get();
const waliB = db.prepare("SELECT * FROM users WHERE username = 'waliB'").get();
check('koordinatorwali exists', !!koordinator);
check('waliA exists and belongs to koordinator', !!waliA && waliA.koordinator_id === koordinator.id);
check('waliB exists and belongs to koordinator', !!waliB && waliB.koordinator_id === koordinator.id);

console.log('\n== 2. Coordinator: full narapidana CRUD (moved from Wali) ==');
function getOwnWaliList(koordinatorId) {
  return db.prepare("SELECT * FROM users WHERE role = 'wali' AND koordinator_id = ? ORDER BY nama").all(koordinatorId);
}
function getOwnedNarapidanaByKoordinator(id, koordinatorId) {
  return db.prepare(`SELECT n.* FROM narapidana n JOIN users u ON u.id = n.wali_id WHERE n.id = ? AND u.koordinator_id = ?`).get(id, koordinatorId);
}
const waliList = getOwnWaliList(koordinator.id);
check('koordinator sees 2 wali (waliA, waliB)', waliList.length === 2);

const insertResult = db.prepare(
  `INSERT INTO narapidana (nama, agama, wali_id, kategori_register) VALUES (?, ?, ?, ?)`
).run('Test Narapidana Baru', 'Islam', waliA.id, 'B1');
const newNarapidanaId = insertResult.lastInsertRowid;
check('coordinator can insert narapidana for own wali', !!getOwnedNarapidanaByKoordinator(newNarapidanaId, koordinator.id));

db.prepare(`UPDATE narapidana SET nama = ? WHERE id = ?`).run('Test Narapidana Diubah', newNarapidanaId);
const afterEdit = getOwnedNarapidanaByKoordinator(newNarapidanaId, koordinator.id);
check('coordinator can edit own narapidana', afterEdit.nama === 'Test Narapidana Diubah');

// Cross-coordinator isolation: a second koordinator must NOT see/own this narapidana.
db.prepare(
  `INSERT INTO users (nama, username, password_hash, role) VALUES (?, ?, ?, 'koordinator_wali')`
).run('Koordinator Lain', 'koordinatorlain', hashPassword('test123'));
const otherKoordinator = db.prepare("SELECT * FROM users WHERE username = 'koordinatorlain'").get();
check('a different coordinator cannot access this narapidana (ownership isolation)',
  !getOwnedNarapidanaByKoordinator(newNarapidanaId, otherKoordinator.id));

db.prepare('DELETE FROM narapidana WHERE id = ?').run(newNarapidanaId);
check('coordinator can delete narapidana', !db.prepare('SELECT * FROM narapidana WHERE id = ?').get(newNarapidanaId));

console.log('\n== 3. Wali: narapidana is now read-only (no mutation routes) ==');
const waliANarapidana = db.prepare('SELECT * FROM narapidana WHERE wali_id = ?').all(waliA.id);
check('waliA still sees their 5 seeded narapidana (read access intact)', waliANarapidana.length === 5);

console.log('\n== 4. Sub-kriteria edit ==');
const kriteria1 = db.prepare('SELECT * FROM kriteria ORDER BY id LIMIT 1').get();
const subInsert = db.prepare('INSERT INTO sub_kriteria (kriteria_id, deskripsi, nilai_skala) VALUES (?, ?, ?)').run(kriteria1.id, 'Deskripsi awal', 3);
const subId = subInsert.lastInsertRowid;
db.prepare("UPDATE sub_kriteria SET deskripsi = ?, nilai_skala = ?, updated_at = datetime('now') WHERE id = ? AND kriteria_id = ?")
  .run('Deskripsi diubah', 5, subId, kriteria1.id);
const subAfter = db.prepare('SELECT * FROM sub_kriteria WHERE id = ?').get(subId);
check('sub-kriteria edit persists', subAfter.deskripsi === 'Deskripsi diubah' && subAfter.nilai_skala === 5);

console.log('\n== 5. Tindak pidana edit ==');
const tp1 = db.prepare('SELECT * FROM tindak_pidana ORDER BY id LIMIT 1').get();
db.prepare("UPDATE tindak_pidana SET jenis = ?, pasal_kuhp = ?, updated_at = datetime('now') WHERE id = ?")
  .run('Jenis Diubah', 'Pasal Baru', tp1.id);
const tpAfter = db.prepare('SELECT * FROM tindak_pidana WHERE id = ?').get(tp1.id);
check('tindak_pidana edit persists', tpAfter.jenis === 'Jenis Diubah' && tpAfter.pasal_kuhp === 'Pasal Baru');

console.log('\n== 6. Periode delete (with cascade) ==');
const periodeInsert = db.prepare(
  `INSERT INTO periode (nama_periode, tahun, eligibility_mode, eligibility_value) VALUES (?, ?, 'threshold', 0.5)`
).run('Periode Uji Hapus', '2026');
const periodeId = periodeInsert.lastInsertRowid;
db.prepare('INSERT INTO penilaian (narapidana_id, kriteria_id, periode_id, nilai) VALUES (?, ?, ?, ?)')
  .run(waliANarapidana[0].id, kriteria1.id, periodeId, 4);
check('penilaian row exists before delete', !!db.prepare('SELECT * FROM penilaian WHERE periode_id = ?').get(periodeId));
db.prepare('DELETE FROM periode WHERE id = ?').run(periodeId);
check('periode deleted', !db.prepare('SELECT * FROM periode WHERE id = ?').get(periodeId));
check('cascade deleted its penilaian rows too (ON DELETE CASCADE)', !db.prepare('SELECT * FROM penilaian WHERE periode_id = ?').get(periodeId));

console.log('\n== 7. Profile password change (hash/verify flow) ==');
const testUser = db.prepare("SELECT * FROM users WHERE username = 'waliA'").get();
check('wrong current password is rejected', !verifyPassword('wrongpass', testUser.password_hash));
check('correct current password verifies', verifyPassword('wali123', testUser.password_hash));
const newHash = hashPassword('newpass456');
db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, testUser.id);
const testUserAfter = db.prepare('SELECT * FROM users WHERE id = ?').get(testUser.id);
check('new password verifies after change', verifyPassword('newpass456', testUserAfter.password_hash));
check('old password no longer verifies', !verifyPassword('wali123', testUserAfter.password_hash));

console.log('\n== 8. Warden: user edit with self-role-lock guard ==');
const kalapas = db.prepare("SELECT * FROM users WHERE username = 'kalapas'").get();
// Simulate the isSelf guard from warden.js POST /users/:id/edit
function simulateUserEdit(targetId, sessionUserId, submittedRole) {
  const editUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  const isSelf = targetId === sessionUserId;
  const finalRole = isSelf ? editUser.role : submittedRole;
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(finalRole, targetId);
  return finalRole;
}
const roleAfterSelfEditAttempt = simulateUserEdit(kalapas.id, kalapas.id, 'wali');
check('warden cannot demote their own role via self-edit', roleAfterSelfEditAttempt === 'kepala_lapas');

const roleAfterOtherEdit = simulateUserEdit(waliB.id, kalapas.id, 'koordinator_wali');
check("warden CAN change another account's role", roleAfterOtherEdit === 'koordinator_wali');
db.prepare("UPDATE users SET role = 'wali', koordinator_id = ? WHERE id = ?").run(koordinator.id, waliB.id); // restore

console.log('\n== 9. TOPSIS engine still intact (unaffected by UI/routing changes) ==');
const { calculateTopsis, applyEligibility } = require(path.join(__dirname, '..', 'src', 'services', 'topsis'));
const kriteriaAll = db.prepare('SELECT * FROM kriteria ORDER BY id').all();
const criteria = kriteriaAll.map((k) => ({ id: k.id, name: k.nama, type: k.jenis, weight: k.bobot }));
const alternatives = waliANarapidana.map((n) => {
  const rows = db.prepare('SELECT kriteria_id, nilai FROM penilaian WHERE narapidana_id = ? AND periode_id = 1').all(n.id);
  const scores = {};
  rows.forEach((r) => { scores[r.kriteria_id] = r.nilai; });
  return { id: n.id, name: n.nama, scores };
});
const calc = calculateTopsis(alternatives, criteria);
check('TOPSIS still produces 5 ranked results', calc.results.length === 5);
check('TOPSIS top rank is Adrian N (matches original checkpoint)', calc.results.find(r => r.rank === 1).name === 'Adrian N');

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
