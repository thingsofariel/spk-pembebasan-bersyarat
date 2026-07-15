const { calculateTopsis, applyEligibility } = require('../src/services/topsis');

// Data straight from the thesis, Table 3.5 / 3.12 (5 narapidana, C1-C6)
const criteria = [
  { id: 'C1', name: 'Mengikuti Program Pembinaan', type: 'benefit', weight: 25 },
  { id: 'C2', name: 'Sikap', type: 'benefit', weight: 15 },
  { id: 'C3', name: 'Rekomendasi Tim Penilai', type: 'benefit', weight: 20 },
  { id: 'C4', name: 'Berkelakuan Baik', type: 'cost', weight: 10 },
  { id: 'C5', name: 'Patuh Aturan', type: 'cost', weight: 15 },
  { id: 'C6', name: 'Bebas Narkoba', type: 'cost', weight: 15 },
];

const alternatives = [
  { id: 'A1', name: 'Egidius B', scores: { C1: 4, C2: 5, C3: 3, C4: 1, C5: 1, C6: 1 } },
  { id: 'A2', name: 'Caytano L', scores: { C1: 1, C2: 1, C3: 1, C4: 5, C5: 4, C6: 3 } },
  { id: 'A3', name: 'Rahimun H', scores: { C1: 1, C2: 5, C3: 1, C4: 3, C5: 2, C6: 1 } },
  { id: 'A4', name: 'Adrian N', scores: { C1: 5, C2: 5, C3: 3, C4: 1, C5: 1, C6: 1 } },
  { id: 'A5', name: 'Mario A', scores: { C1: 1, C2: 1, C3: 1, C4: 5, C5: 4, C6: 1 } },
];

const result = calculateTopsis(alternatives, criteria);
const withStatus = applyEligibility(result.results, { mode: 'threshold', value: 0.5 });

console.log('=== Normalized weights (should sum to 1) ===');
console.log(result.criteria.map((c) => `${c.id}=${c.weight.toFixed(3)}`).join(', '));

console.log('\n=== Ranking (vector normalization method) ===');
withStatus.forEach((r) => {
  console.log(`#${r.rank}  ${r.name.padEnd(12)} Vi=${r.score.toFixed(4)}  ${r.status}`);
});

console.log('\nNote: these Vi values will differ from the thesis appendix (0.5699, 0.3875, ...)');
console.log('because the thesis worked example used linear max/min normalization,');
console.log('while this engine correctly implements the formally-stated vector');
console.log('normalization (Persamaan 2.1) per your instruction. Rank order is');
console.log('the important thing to sanity-check here, not the exact decimals.');
