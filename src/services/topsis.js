/**
 * TOPSIS Engine
 * Technique for Order Preference by Similarity to Ideal Solution
 *
 * Implements the formal method as defined in the thesis, Section 2.5
 * (Luh Made & Wijaya, 2019), using VECTOR NORMALIZATION:
 *
 *   1. rij = Xij / sqrt(sum_i(Xij^2))                    Persamaan (2.1)
 *   2. yij = wj * rij                                     Persamaan (2.2)
 *   3. A+ = (y1+, y2+, ..., yn+)  -> max for benefit, min for cost
 *      A- = (y1-, y2-, ..., yn-)  -> min for benefit, max for cost
 *                                                          Persamaan (2.3, 2.4)
 *   4. Di+ = sqrt(sum_j((yj+ - yij)^2))                   Persamaan (2.5)
 *      Di- = sqrt(sum_j((yij - yj-)^2))                   Persamaan (2.6)
 *   5. Vi = Di- / (Di- + Di+)                             Persamaan (2.7)
 *   6. Rank alternatives by Vi, descending.
 *
 * This module is pure (no DB/HTTP), so it can be unit-tested in isolation
 * and reused anywhere (API route, CLI, tests).
 */

/**
 * @typedef {Object} Criterion
 * @property {string|number} id
 * @property {string} name
 * @property {'benefit'|'cost'} type
 * @property {number} weight - can be given as raw points (e.g. 25) or a
 *   fraction (0.25); this module normalizes weights to sum to 1 automatically.
 *
 * @typedef {Object} Alternative
 * @property {string|number} id
 * @property {string} name
 * @property {Object.<string, number>} scores - map of criterionId -> raw score (Xij)
 */

/**
 * Validate inputs and throw descriptive errors early, rather than letting
 * NaNs silently propagate through the whole calculation.
 */
function validateInputs(alternatives, criteria) {
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    throw new Error('At least one alternative (prisoner) is required.');
  }
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new Error('At least one criterion is required.');
  }
  for (const c of criteria) {
    if (c.type !== 'benefit' && c.type !== 'cost') {
      throw new Error(`Criterion "${c.name}" must have type "benefit" or "cost", got "${c.type}".`);
    }
    if (typeof c.weight !== 'number' || Number.isNaN(c.weight) || c.weight < 0) {
      throw new Error(`Criterion "${c.name}" has an invalid weight: ${c.weight}`);
    }
  }
  for (const alt of alternatives) {
    for (const c of criteria) {
      const v = alt.scores[c.id];
      if (typeof v !== 'number' || Number.isNaN(v)) {
        throw new Error(`Alternative "${alt.name}" is missing a numeric score for criterion "${c.name}" (id=${c.id}).`);
      }
    }
  }
}

/**
 * Normalize weights so they sum to 1, regardless of whether the caller
 * passed raw points (e.g. 25/15/20/10/15/15) or fractions (0.25/0.15/...).
 */
function normalizeWeights(criteria) {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) throw new Error('Sum of criteria weights must be greater than 0.');
  return criteria.map((c) => ({ ...c, weight: c.weight / total }));
}

/**
 * Run the full TOPSIS calculation.
 *
 * @param {Alternative[]} alternatives
 * @param {Criterion[]} criteria
 * @returns {{
 *   criteria: Criterion[],          // with normalized weights
 *   decisionMatrix: number[][],     // X, rows=alternatives, cols=criteria
 *   normalizedMatrix: number[][],   // R
 *   weightedMatrix: number[][],     // Y
 *   idealPositive: number[],        // A+
 *   idealNegative: number[],        // A-
 *   distances: {alternativeId, dPositive, dNegative}[],
 *   results: {alternativeId, name, score, rank}[]  // sorted, descending
 * }}
 */
function calculateTopsis(alternatives, criteria) {
  validateInputs(alternatives, criteria);
  const normCriteria = normalizeWeights(criteria);

  // 1. Build the decision matrix X (rows = alternatives, cols = criteria)
  const decisionMatrix = alternatives.map((alt) =>
    normCriteria.map((c) => alt.scores[c.id])
  );

  // 2. Vector normalization -> R  (Persamaan 2.1)
  const m = alternatives.length;
  const n = normCriteria.length;
  const colNorms = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let sumSq = 0;
    for (let i = 0; i < m; i++) sumSq += decisionMatrix[i][j] ** 2;
    colNorms[j] = Math.sqrt(sumSq);
  }
  const normalizedMatrix = decisionMatrix.map((row) =>
    row.map((v, j) => (colNorms[j] === 0 ? 0 : v / colNorms[j]))
  );

  // 3. Weighted normalized matrix -> Y  (Persamaan 2.2)
  const weightedMatrix = normalizedMatrix.map((row) =>
    row.map((v, j) => v * normCriteria[j].weight)
  );

  // 4. Ideal positive (A+) and ideal negative (A-)  (Persamaan 2.3, 2.4)
  const idealPositive = new Array(n);
  const idealNegative = new Array(n);
  for (let j = 0; j < n; j++) {
    const col = weightedMatrix.map((row) => row[j]);
    const colMax = Math.max(...col);
    const colMin = Math.min(...col);
    if (normCriteria[j].type === 'benefit') {
      idealPositive[j] = colMax;
      idealNegative[j] = colMin;
    } else {
      idealPositive[j] = colMin;
      idealNegative[j] = colMax;
    }
  }

  // 5. Distances to ideal positive/negative  (Persamaan 2.5, 2.6)
  const distances = weightedMatrix.map((row, i) => {
    let sumPos = 0;
    let sumNeg = 0;
    for (let j = 0; j < n; j++) {
      sumPos += (idealPositive[j] - row[j]) ** 2;
      sumNeg += (row[j] - idealNegative[j]) ** 2;
    }
    return {
      alternativeId: alternatives[i].id,
      dPositive: Math.sqrt(sumPos),
      dNegative: Math.sqrt(sumNeg),
    };
  });

  // 6. Preference score Vi  (Persamaan 2.7) + ranking
  const results = distances.map((d, i) => {
    const denom = d.dPositive + d.dNegative;
    const score = denom === 0 ? 0 : d.dNegative / denom;
    return {
      alternativeId: alternatives[i].id,
      name: alternatives[i].name,
      score,
    };
  });
  results.sort((a, b) => b.score - a.score);
  results.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return {
    criteria: normCriteria,
    decisionMatrix,
    normalizedMatrix,
    weightedMatrix,
    idealPositive,
    idealNegative,
    distances,
    results,
  };
}

/**
 * Apply a pass/fail cutoff on top of a TOPSIS result set.
 * Two modes are supported because the thesis itself is not fully consistent
 * about which one it used:
 *   - { mode: 'threshold', value: 0.5 }  -> Vi >= value is "Lulus" (passed)
 *   - { mode: 'quota', value: 5 }        -> top N alternatives are "Lulus"
 *
 * Returns the same results array with a `status` field attached.
 */
function applyEligibility(results, rule = { mode: 'threshold', value: 0.5 }) {
  if (rule.mode === 'quota') {
    return results.map((r) => ({
      ...r,
      status: r.rank <= rule.value ? 'Lulus' : 'Tidak Lulus',
    }));
  }
  // default: threshold mode
  return results.map((r) => ({
    ...r,
    status: r.score >= rule.value ? 'Lulus' : 'Tidak Lulus',
  }));
}

module.exports = { calculateTopsis, applyEligibility, normalizeWeights };
