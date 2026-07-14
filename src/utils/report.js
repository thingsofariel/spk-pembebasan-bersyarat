const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a CSV report of TOPSIS results and write it to /uploads.
 * Returns { fileName, filePath } where filePath is absolute on disk.
 */
function writeHasilReportCsv({ periodeNama, waliNama, rows }) {
  const header = ['Peringkat', 'Nama Narapidana', 'Nilai Preferensi (Vi)', 'Status'];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(
      [r.peringkat, r.nama, r.nilai_preferensi.toFixed(6), r.status].map(csvEscape).join(',')
    );
  }
  const content = lines.join('\n');

  const safePeriode = periodeNama.replace(/[^a-z0-9]+/gi, '_');
  const safeWali = waliNama.replace(/[^a-z0-9]+/gi, '_');
  const fileName = `laporan_topsis_${safeWali}_${safePeriode}_${Date.now()}.csv`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(filePath, content, 'utf8');

  return { fileName, filePath };
}

module.exports = { writeHasilReportCsv, UPLOADS_DIR };
