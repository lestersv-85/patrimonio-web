/** Standalone conditioned LWS diagnostics. No approved allocation or historical-return forecast.
 * validateConfig returns {valid, errors, warnings, eligible, pending}; invalid input never sizes capital.
 * individualKelly returns a diagnostic object (kelly/weight null when pending).
 * options: capitalEUR, maxIterations, tolerance, ipfTolerance, ipfMaxIterations, onProgress(message, {phase, iterations?, error?, gap?}).
 * Amounts require explicit options.capitalEUR, config.capitalEUR/baseValueEUR or bundle.capitalEUR; absent is null.
 */
const finite = x => typeof x === 'number' && Number.isFinite(x);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const idOf = p => p.id ?? p.ticker;
const EPS = 1e-10;

function hasEvidence(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasEvidence);
  if (value && typeof value === 'object') return Object.values(value).some(hasEvidence);
  return false;
}

function reportProgress(options, event) {
  const message = event.phase === 'start' ? 'Preparando diagnóstico condicionado…'
    : event.phase === 'ipf' ? `Ajustando marginales · iteración ${event.iterations} · error ${event.error}`
    : event.phase === 'solver' ? `Optimizando · iteración ${event.iterations} · gap ${event.gap}`
    : `Diagnóstico terminado · convergencia ${event.converged ? 'comprobada' : 'pendiente'}`;
  options.onProgress?.(message, event);
}

function inspectPosition(p, parameters) {
  const reasons = [];
  if (p.inputStatus === 'pending') reasons.push('inputStatus pending');
  if (parameters.probabilityMode === 'documented' && !hasEvidence(p.probabilityEvidence)) reasons.push('probabilityEvidence missing in documented mode');
  if (p.returns == null || p.probabilities == null ||
      (Array.isArray(p.returns) && p.returns.some(x => x == null)) ||
      (Array.isArray(p.probabilities) && p.probabilities.some(x => x == null))) reasons.push('returns/probabilities missing');
  if (p.horizonYears == null) reasons.push('horizonYears missing');
  if (p.cap == null) reasons.push('cap missing');
  if (reasons.length) return { pending: true, reasons };
  if (!Array.isArray(p.returns) || p.returns.length !== 3 ||
      !p.returns.every(x => finite(x) && x >= -1) ||
      !Array.isArray(p.probabilities) || p.probabilities.length !== 3 ||
      !p.probabilities.every(x => finite(x) && x >= 0 && x <= 1) ||
      Math.abs(sum(p.probabilities) - 1) > EPS ||
      !finite(p.horizonYears) || p.horizonYears <= 0 || !finite(p.cap) || p.cap < 0 || p.cap > 1)
    return { error: 'Invalid cases, probabilities, horizon or cap' };
  if (p.horizonYears !== parameters.horizonYears &&
      (parameters.postExitPolicy !== 'cash' || p.horizonYears > parameters.horizonYears))
    return { error: 'Mixed horizons require explicit postExitPolicy cash and shorter source horizon' };
  const probabilities = p.probabilities.map(x => x / sum(p.probabilities));
  const growth = (1 + parameters.cashAnnual) ** (parameters.horizonYears - p.horizonYears);
  return { returns: p.returns.map(r => (1 + r) * growth - 1), probabilities };
}

export function validateConfig(config) {
  const errors = [], warnings = [], pending = [], eligible = [];
  if (!config || typeof config !== 'object') return { valid: false, errors: ['Config missing'], warnings, eligible, pending };
  const p = config.parameters ?? {};
  for (const k of ['cashAnnual', 'kellyFraction', 'minimumCash', 'horizonYears', 'maxStocks'])
    if (!finite(p[k])) errors.push(`parameters.${k} must be finite`);
  if (!(p.cashAnnual > -1)) errors.push('cashAnnual must exceed -1');
  if (!(p.kellyFraction >= 0 && p.kellyFraction <= 1)) errors.push('kellyFraction outside [0,1]');
  if (!(p.minimumCash >= 0 && p.minimumCash <= 1)) errors.push('minimumCash outside [0,1]');
  if (!(p.horizonYears > 0)) errors.push('horizonYears must be positive');
  if (!Number.isInteger(p.maxStocks) || p.maxStocks < 0) errors.push('maxStocks must be a nonnegative integer');
  if (!['pending', 'cash'].includes(p.postExitPolicy)) errors.push('Invalid postExitPolicy');
  if (!['inherited-diagnostic', 'documented'].includes(p.probabilityMode)) errors.push('Unsupported probabilityMode');
  const categories = new Map();
  if (!Array.isArray(config.categories) || !Array.isArray(config.positions)) {
    errors.push('categories and positions must be arrays');
    return { valid: false, errors, warnings, eligible, pending };
  }
  for (const c of config.categories ?? []) {
    if (!c || typeof c !== 'object') { errors.push('Invalid category'); continue; }
    if (!c.id || categories.has(c.id)) errors.push('Missing/duplicate category id');
    if (c.id !== 'cash' && !['stable', 'convex'].includes(c.block)) errors.push(`Invalid block: ${c.id}`);
    if (!finite(c.budget) || c.budget < 0 || c.budget > 1) errors.push(`Invalid category budget: ${c.id}`);
    categories.set(c.id, c);
  }
  if (!categories.has('cash')) errors.push('cash category required (without a cash position)');
  if (config.categories.every(c => c && finite(c.budget)) && Math.abs(sum(config.categories.map(c => c.budget)) - 1) > EPS)
    errors.push('Category budgets must sum to 1 (100%), including cash; budgets remain maxima');
  const ids = new Set();
  if (!Array.isArray(config.positions)) errors.push('positions must be an array');
  for (const pos of config.positions ?? []) {
    if (!pos || typeof pos !== 'object') { errors.push('Invalid position'); continue; }
    const id = idOf(pos);
    if (!id || ids.has(id)) errors.push('Missing/duplicate position id');
    ids.add(id);
    if (pos.categoryId === 'cash' || !categories.has(pos.categoryId)) errors.push(`Invalid category: ${id}`);
    if (!['stock', 'vehicle', 'gold', 'crypto'].includes(pos.type)) errors.push(`Invalid type: ${id}`);
    if (!['conditional', 'pending'].includes(pos.inputStatus)) errors.push(`Invalid inputStatus: ${id}`);
    if (typeof pos.enabled !== 'boolean') errors.push(`enabled must be boolean: ${id}`);
    const state = inspectPosition(pos, p);
    if (state.error) errors.push(`${id}: ${state.error}`);
    if (state.pending) pending.push({ id, reasons: state.reasons });
    else if (!state.error && pos.enabled) eligible.push(id);
  }
  const stocks = (config.positions ?? []).filter(x => x?.enabled && x.type === 'stock').length;
  if (stocks > p.maxStocks) warnings.push(`maxStocks: ${stocks} enabled stocks exceed ${p.maxStocks}; no automatic selection or forced slots`);
  if (pending.length) warnings.push('Pending positions excluded only from conditioned diagnostics; allocations remain null and slots are not forced');
  warnings.push(p.probabilityMode === 'documented'
    ? 'Conditioned diagnostic only; probabilityEvidence records assertions, not independently validated forecasts or approval'
    : 'Conditioned diagnostic only; inherited probabilities are not validated forecasts or approvals');
  return { valid: errors.length === 0, errors, warnings, eligible, pending };
}

export function individualKelly(position, parameters) {
  const state = inspectPosition(position, parameters);
  if (state.pending || state.error) return { status: state.error ? 'invalid' : 'pending', kelly: null, weight: null, expectedReturn: null, expectedReturn5y: null, score: null, exact: null, reasons: state.reasons ?? [state.error] };
  const cashReturn = (1 + parameters.cashAnnual) ** parameters.horizonYears - 1;
  const cases = state.returns.map((r, i) => ({ r, p: state.probabilities[i] })).filter(x => x.p > 0);
  const excess = cases.map(x => x.r - cashReturn);
  const mean = sum(cases.map(x => x.p * x.r));
  const variance = sum(cases.map(x => x.p * (x.r - mean) ** 2));
  const derivative = f => sum(cases.map((x, i) => {
    const wealth = 1 + cashReturn + f * excess[i];
    return wealth <= 0 ? -Infinity : x.p * excess[i] / wealth;
  }));
  let kelly;
  if (derivative(0) <= 0) kelly = 0;
  else if (derivative(1) >= 0) kelly = 1;
  else {
    let lo = 0, hi = 1;
    for (let i = 0; i < 90; i++) { const mid = (lo + hi) / 2; if (derivative(mid) > 0) lo = mid; else hi = mid; }
    kelly = (lo + hi) / 2;
  }
  // Zero variance with positive excess has unbounded diagnostic score; normalization handles it explicitly.
  const score = mean <= cashReturn ? 0 : variance === 0 ? Infinity : (mean - cashReturn) / variance;
  return { status: 'conditional', kelly, weight: kelly, expectedReturn: mean,
    expectedReturn5y: parameters.horizonYears === 5 ? mean : null, score: Number.isFinite(score) ? score : null, exact: kelly,
    mean, variance, cashReturn, excessMean: mean - cashReturn,
    lwsScore: Number.isFinite(score) ? score : null, deterministicPositiveExcess: score === Infinity,
    returns: state.returns, probabilities: state.probabilities };
}

function decodeUniforms(u) {
  if (!u || u.encoding !== 'float64-le-base64' || !Number.isInteger(u.rows) || u.rows < 1 ||
      !Array.isArray(u.ids) || !u.ids.length || new Set(u.ids).size !== u.ids.length || typeof u.data !== 'string') throw Error('Invalid uniforms metadata');
  const raw = atob(u.data), expected = u.rows * u.ids.length * 8;
  if (raw.length !== expected) throw Error('Uniforms byte length mismatch');
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0)), view = new DataView(bytes.buffer);
  const values = new Float64Array(u.rows * u.ids.length);
  for (let i = 0; i < values.length; i++) {
    values[i] = view.getFloat64(i * 8, true);
    if (!finite(values[i]) || values[i] < 0 || values[i] >= 1) throw Error('Uniform outside [0,1)');
  }
  return values;
}

function buildLaw(active, bundle, options) {
  const u = bundle?.uniforms, values = decodeUniforms(u), n = active.length, rows = u.rows;
  const states = new Uint8Array(rows * n), masses = new Float64Array(rows).fill(1 / rows);
  const excess = new Float64Array(rows * n);
  for (let j = 0; j < n; j++) {
    const p = active[j], col = u.ids.indexOf(p.ticker ?? idOf(p));
    if (col < 0) throw Error(`Uniforms missing id ${idOf(p)}`);
    const probs = p.diagnostic.probabilities;
    for (let i = 0; i < rows; i++) {
      const v = values[i * u.ids.length + col];
      states[i * n + j] = v < probs[0] ? 0 : v < probs[0] + probs[1] ? 1 : 2;
    }
  }
  const tolerance = options.ipfTolerance ?? 1e-10, maxIterations = options.ipfMaxIterations ?? 2000;
  let error = Infinity, iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    for (let j = 0; j < n; j++) {
      const totals = [0, 0, 0], probs = active[j].diagnostic.probabilities;
      for (let i = 0; i < rows; i++) totals[states[i * n + j]] += masses[i];
      for (let s = 0; s < 3; s++) if (probs[s] > 0 && totals[s] === 0) throw Error(`IPF unsupported positive marginal: ${idOf(active[j])} case ${s}`);
      const ratios = probs.map((p, s) => totals[s] ? p / totals[s] : 0);
      for (let i = 0; i < rows; i++) masses[i] *= ratios[states[i * n + j]];
    }
    error = 0;
    for (let j = 0; j < n; j++) {
      const totals = [0, 0, 0];
      for (let i = 0; i < rows; i++) totals[states[i * n + j]] += masses[i];
      for (let s = 0; s < 3; s++) error = Math.max(error, Math.abs(totals[s] - active[j].diagnostic.probabilities[s]));
    }
    if (iterations % 20 === 0) reportProgress(options, { phase: 'ipf', iterations: iterations + 1, error });
    if (error <= tolerance) { iterations++; break; }
  }
  const cash = active[0].diagnostic.cashReturn;
  for (let i = 0; i < rows; i++) for (let j = 0; j < n; j++) excess[i * n + j] = active[j].diagnostic.returns[states[i * n + j]] - cash;
  return { rows, n, masses, excess, cash, ipf: { error, converged: error <= tolerance, iterations, tolerance, rows } };
}

function optimize(law, active, categories, parameters, options) {
  const { rows, n, masses, excess, cash } = law;
  const groups = categories.filter(c => c.id !== 'cash').map(c => ({ budget: c.budget, indices: active.map((p, j) => p.categoryId === c.id ? j : -1).filter(j => j >= 0) }));
  const totalCap = 1 - parameters.minimumCash, caps = active.map(p => p.cap);
  // Euclidean projection: nested water filling of disjoint category caps and global cap.
  function project(v) {
    function at(lambda) {
      const x = v.map((z, j) => Math.min(caps[j], Math.max(0, z - lambda)));
      for (const g of groups) {
        if (sum(g.indices.map(j => x[j])) <= g.budget) continue;
        let lo = 0, hi = Math.max(0, ...g.indices.map(j => v[j] - lambda));
        for (let k = 0; k < 55; k++) {
          const mid = (lo + hi) / 2;
          const s = sum(g.indices.map(j => Math.min(caps[j], Math.max(0, v[j] - lambda - mid))));
          if (s > g.budget) lo = mid; else hi = mid;
        }
        for (const j of g.indices) x[j] = Math.min(caps[j], Math.max(0, v[j] - lambda - hi));
      }
      return x;
    }
    let x = at(0);
    if (sum(x) <= totalCap) return x;
    let lo = 0, hi = Math.max(0, ...v);
    for (let k = 0; k < 55; k++) { const mid = (lo + hi) / 2; if (sum(at(mid)) > totalCap) lo = mid; else hi = mid; }
    return at(hi);
  }
  function evaluate(w) {
    let value = 0; const gradient = new Array(n).fill(0);
    for (let i = 0; i < rows; i++) {
      if (masses[i] === 0) continue;
      let wealth = 1 + cash;
      for (let j = 0; j < n; j++) wealth += w[j] * excess[i * n + j];
      if (wealth <= 0) return { value: -Infinity, gradient };
      value += masses[i] * Math.log(wealth);
      const factor = masses[i] / wealth;
      for (let j = 0; j < n; j++) gradient[j] += factor * excess[i * n + j];
    }
    return { value, gradient };
  }
  function oracle(gradient) {
    const x = new Array(n).fill(0), remaining = new Map(categories.map(c => [c.id, c.budget]));
    let room = totalCap;
    const order = active.map((_, j) => j).sort((a, b) => gradient[b] - gradient[a]);
    for (const j of order) {
      if (gradient[j] <= 0) break;
      const cat = active[j].categoryId, take = Math.min(caps[j], room, remaining.get(cat));
      x[j] = Math.max(0, take); room -= x[j]; remaining.set(cat, remaining.get(cat) - x[j]);
    }
    return x;
  }
  let w = new Array(n).fill(0), e = evaluate(w), step = 1, gap = Infinity, iterations = 0;
  const tolerance = options.tolerance ?? 1e-8, maxIterations = options.maxIterations ?? 1500;
  let reason = 'iteration-limit';
  for (; iterations < maxIterations; iterations++) {
    const target = oracle(e.gradient);
    gap = sum(target.map((z, j) => (z - w[j]) * e.gradient[j]));
    if (iterations % 20 === 0) reportProgress(options, { phase: 'solver', iterations, gap });
    if (gap <= tolerance) { reason = 'kkt-gap'; break; }
    let candidate, next, accepted = false, localStep = step;
    for (let b = 0; b < 60; b++) {
      candidate = project(w.map((z, j) => z + localStep * e.gradient[j]));
      next = evaluate(candidate);
      const improvement = sum(candidate.map((z, j) => (z - w[j]) * e.gradient[j]));
      if (next.value >= e.value + 1e-4 * improvement - 1e-15 && Number.isFinite(next.value)) { accepted = true; break; }
      localStep *= 0.5;
    }
    if (!accepted) { reason = 'line-search-failed'; break; }
    const delta = candidate.map((z, j) => z - w[j]);
    const curvature = sum(delta.map((z, j) => z * (e.gradient[j] - next.gradient[j])));
    step = curvature > 0 ? Math.min(1e8, Math.max(1e-8, sum(delta.map(z => z * z)) / curvature)) : localStep * 2;
    w = candidate; e = next;
  }
  const target = oracle(e.gradient);
  gap = Math.max(0, sum(target.map((z, j) => (z - w[j]) * e.gradient[j])));
  return { weights: w, solver: { gap, converged: gap <= tolerance, iterations, tolerance, reason, objective: e.value, method: 'projected-gradient-backtracking-BB-linear-oracle-KKT' } };
}

function emptyRisk() {
  return { volatility: null, diversificationRatio: null, weightedPairCorrelation: null,
    pairs: [], positionRisk: [], count: 0, n: 0,
    coverage: { complete: false, positiveCount: 0, coveredCount: 0, positiveWeight: null, coveredWeight: null, ratio: null, unknownPositive: [] } };
}

function historicalRisk(positions, history, warnings) {
  const considered = positions.filter(p => p.enabled);
  const held = considered.filter(p => finite(p.weight) && p.weight > 0);
  const n = held.length, positiveWeight = sum(held.map(p => p.weight));
  const metaValid = history && Array.isArray(history.codes) && Array.isArray(history.returns) && history.returns.length >= 2 &&
    history.observations === history.returns.length && finite(history.periodsPerYear) && history.periodsPerYear > 0 &&
    new Set(history.codes).size === history.codes.length;
  const rows = metaValid ? history.returns.length : 0;
  const columns = considered.map(p => metaValid ? history.codes.indexOf(p.ticker ?? idOf(p)) : -1);
  const covered = columns.map(c => c >= 0 && history.returns.every(r => Array.isArray(r) && finite(r[c])));
  const means = columns.map((c, j) => covered[j] ? sum(history.returns.map(r => r[c])) / rows : null);
  const cov = columns.map((c, j) => columns.map((d, k) => covered[j] && covered[k]
    ? sum(history.returns.map(r => (r[c] - means[j]) * (r[d] - means[k]))) / (rows - 1) * history.periodsPerYear : null));
  const vol = cov.map((r, j) => r[j] === null ? null : Math.sqrt(Math.max(0, r[j])));
  const indices = considered.map((p, j) => p.weight > 0 ? j : -1).filter(j => j >= 0);
  const unknownPositive = indices.filter(j => !covered[j]).map(j => idOf(considered[j]));
  const coveredWeight = sum(indices.filter(j => covered[j]).map(j => considered[j].weight));
  const coverage = { complete: unknownPositive.length === 0, positiveCount: n, coveredCount: n - unknownPositive.length,
    positiveWeight, coveredWeight, ratio: positiveWeight > 0 ? coveredWeight / positiveWeight : 1, unknownPositive,
    pending: considered.filter(p => p.weight === null).map(idOf) };
  const pairs = [];
  let pairSum = 0, pairWeight = 0, unknownWeightedPair = false;
  const clamp = x => Math.max(-1, Math.min(1, x));
  for (let j = 0; j < considered.length; j++) for (let k = j + 1; k < considered.length; k++) {
    const correlation = vol[j] > 0 && vol[k] > 0 ? clamp(cov[j][k] / vol[j] / vol[k]) : null;
    pairs.push({ a: idOf(considered[j]), b: idOf(considered[k]), correlation,
      signal: correlation === null ? 'unknown' : correlation > .6 ? 'alert' : correlation < .3 ? 'favorable' : 'neutral' });
    if (considered[j].weight > 0 && considered[k].weight > 0) {
      if (correlation === null) unknownWeightedPair = true;
      else { const weight = considered[j].weight * considered[k].weight; pairSum += weight * correlation; pairWeight += weight; }
    }
  }
  let variance = null;
  if (coverage.complete) {
    variance = 0;
    for (const j of indices) for (const k of indices) variance += considered[j].weight * considered[k].weight * cov[j][k];
    variance = Math.max(0, variance);
  }
  const volatility = variance === null ? null : Math.sqrt(variance);
  const positionRisk = considered.map((p, j) => {
    let correlationToRest = null, riskContributionShare = null;
    if (coverage.complete) {
      if (variance > 0 && finite(p.weight) && (covered[j] || p.weight === 0)) {
        riskContributionShare = p.weight === 0 ? 0 : p.weight * sum(indices.map(k => considered[k].weight * cov[j][k])) / variance;
      }
      if (covered[j] && vol[j] > 0) {
        const rest = indices.filter(k => k !== j);
        let restVariance = 0;
        for (const k of rest) for (const l of rest) restVariance += considered[k].weight * considered[l].weight * cov[k][l];
        if (restVariance > 0) correlationToRest = clamp(sum(rest.map(k => considered[k].weight * cov[j][k])) / vol[j] / Math.sqrt(restVariance));
      }
    }
    return { id: idOf(p), correlationToRest, riskContributionShare };
  });
  if (!coverage.complete || !metaValid && n) warnings.push('History missing for positive exposures; aggregate risk and contribution metrics unavailable, never zero-filled');
  if (metaValid && rows < 5 * history.periodsPerYear) warnings.push('Historical window shorter than five years; no validated future dependence');
  return { volatility,
    diversificationRatio: volatility > 0 ? sum(indices.map(j => vol[j] * considered[j].weight)) / volatility : null,
    weightedPairCorrelation: coverage.complete && !unknownWeightedPair && pairWeight > 0 ? pairSum / pairWeight : null,
    pairs, positionRisk, count: n, n, coverage, observations: metaValid ? rows : null,
    periodsPerYear: metaValid ? history.periodsPerYear : null,
    scope: 'category-normalized plan exposures only; pending weights unknown; cash deterministic; historical means only center covariance' };
}

export async function calculateLWS(config, bundle, options = {}) {
  const validation = validateConfig(config), warnings = [...validation.warnings];
  const pending = validation.pending;
  const result = { status: 'invalid', approved: false, positions: [], cashFull: null, cashFractional: null,
    categoryWeights: {}, categoryDetails: [], historyRisk: emptyRisk(),
    solver: { gap: null, converged: false }, warnings, pending, errors: validation.errors };
  if (!validation.valid) return result;
  for (const name of ['tolerance', 'ipfTolerance']) if (options[name] !== undefined && (!finite(options[name]) || options[name] <= 0)) result.errors.push(`Invalid option ${name}`);
  for (const name of ['maxIterations', 'ipfMaxIterations']) if (options[name] !== undefined && (!Number.isInteger(options[name]) || options[name] < 0)) result.errors.push(`Invalid option ${name}`);
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') result.errors.push('onProgress must be a function');
  if (result.errors.length) return result;
  reportProgress(options, { phase: 'start' });
  const parameters = config.parameters;
  result.positions = config.positions.map(p => ({ ...p, diagnostic: individualKelly(p, parameters), fullWeight: null, weight: null, amountEUR: null, lwsWeight: null }));
  const active = result.positions.filter(p => p.enabled && p.diagnostic.status === 'conditional');
  for (const p of result.positions) if (!p.enabled && p.diagnostic.status !== 'pending') { p.fullWeight = 0; p.weight = 0; p.lwsWeight = 0; }
  if (pending.length) warnings.push('Allocation is a subset diagnostic; pending allocations and their unknown risk remain null, not rejection zeros');
  const capital = options.capitalEUR ?? config.capitalEUR ?? config.baseValueEUR ?? bundle?.capitalEUR;
  if (capital != null && (!finite(capital) || capital < 0)) { result.errors.push('capitalEUR must be nonnegative and finite'); return result; }
  if (!finite(capital)) warnings.push('capitalEUR missing; amountEUR remains null');
  let solution;
  if (active.length) {
    try {
      const law = buildLaw(active, bundle, options);
      result.solver.ipf = law.ipf;
      if (!law.ipf.converged) throw Error('Global IPF did not converge; category calculations remain independent');
      solution = optimize(law, active, config.categories, parameters, options);
      result.solver = { ...solution.solver, ipf: law.ipf };
    } catch (error) { warnings.push(error.message); solution = {weights: active.map(()=>null), solver:{gap:null,converged:false,reason:'global-diagnostic-unavailable'}};result.solver={...result.solver,...solution.solver}; }
  } else solution = { weights: [], solver: { gap: 0, converged: true, iterations: 0, reason: 'no-eligible-positions' } };
  if (!active.length) result.solver = solution.solver;
  const globalConverged = result.solver.converged;
  result.solver.global = {...result.solver};
  if (!globalConverged) result.solver.iterateWeights = Object.fromEntries(active.map((p,j)=>[idOf(p),solution.weights[j]]));
  if (!globalConverged) warnings.push('Global diagnostic unavailable or not converged; category allocations are calculated independently.');
  active.forEach((p, j) => { p.fullWeight = globalConverged ? solution.weights[j] : null; p.weight = 0; });
  result.solver.converged = true;
  // The fraction scales internal scores; normalization preserves each strategic budget.
  // Final weights are a category policy allocation, not the unconstrained log optimum.
  result.solver.categories = {};
  for (const c of config.categories.filter(c => c.id !== 'cash')) {
    const group = active.filter(p => p.categoryId === c.id);
    if (group.length && c.budget > 0) {
      try {
        const law = buildLaw(group, bundle, options);
        if (!law.ipf.converged) throw Error(`Category ${c.id}: IPF did not converge`);
        const internal = group.map(p => ({...p, cap: Math.min(1, p.cap / c.budget)}));
        const solved = optimize(law, internal, [{...c, budget: 1}], {...parameters, minimumCash: 0}, options);
        result.solver.categories[c.id] = {...solved.solver, ipf: law.ipf};
        if (!law.ipf.converged || !solved.solver.converged) throw Error(`Category ${c.id}: solver convergence not established`);
        group.forEach((p,j) => {p.categoryKellyWeight = solved.weights[j];});
      } catch(error) {
        result.status = error.message.includes('solver convergence') ? 'not-converged' : 'pending'; result.solver.converged = false; warnings.push(error.message);
        for (const p of active) {p.weight = null; p.amountEUR = null;}
        return result;
      }
    }
    let remaining = c.budget;
    let members = active.filter(p => p.categoryId === c.id && parameters.kellyFraction > 0 && p.categoryKellyWeight > 1e-10);
    while (members.length && remaining > EPS) {
      const denominator = sum(members.map(p => p.categoryKellyWeight));
      const capped = members.filter(p => remaining * p.categoryKellyWeight / denominator >= p.cap);
      if (!capped.length) { for (const p of members) p.weight = remaining * p.categoryKellyWeight / denominator; remaining = 0; break; }
      for (const p of capped) { p.weight = p.cap; remaining -= p.cap; }
      members = members.filter(p => !capped.includes(p));
    }
    if (remaining > EPS && c.budget > 0) warnings.push(`Category ${c.id}: unallocated budget retained in cash (pending inputs, no positive joint support, zero fraction or position caps)`);
  }
  const assigned = sum(active.map(p => p.weight));
  if (assigned > 1 - parameters.minimumCash + EPS) {
    result.status = 'invalid'; result.errors.push('Category allocation conflicts with minimumCash; adjust category budgets or reserve, without silently scaling final weights');
    for (const p of active) { p.weight = null; p.amountEUR = null; }
    return result;
  }
  result.solver.gap = Math.max(0,...Object.values(result.solver.categories).map(s=>s.gap));
  result.solver.tolerance = options.tolerance ?? 1e-8;
  result.allocationPolicy = 'fraction-within-category-normalized';
  warnings.push('Final category-normalized weights preserve strategic budgets where eligible capacity permits; they are not the global joint log-optimal vector. A common positive Kelly fraction cancels in normalization.');
  for (const c of config.categories.filter(c => c.id !== 'cash')) {
    const members = active.filter(p => p.categoryId === c.id);
    const deterministic = members.filter(p => p.diagnostic.deterministicPositiveExcess);
    const denominator = sum(members.map(p => p.diagnostic.lwsScore ?? 0));
    for (const p of members) {
      const share = deterministic.length ? (p.diagnostic.deterministicPositiveExcess ? 1 / deterministic.length : 0) : denominator > 0 ? p.diagnostic.lwsScore / denominator : 0;
      p.lwsWeight = Math.min(p.cap, c.budget * share);
    }
  }
  // Scores are a separate category-normalized comparison, not the constrained joint optimizer.
  const lwsSum = sum(active.map(p => p.lwsWeight));
  if (lwsSum > 1 - parameters.minimumCash + EPS) warnings.push('Category-normalized LWS comparison exceeds joint investable budget; not an executable allocation');
  for (const p of result.positions) if (p.weight !== null && finite(capital)) p.amountEUR = p.weight * capital;
  result.cashFull = globalConverged ? 1 - sum(active.map(p => p.fullWeight)) : null;
  result.cashFractional = 1 - sum(active.map(p => p.weight));
  result.categoryDetails = config.categories.map(c => ({ id: c.id, budget: c.budget,
    fullWeight: !globalConverged ? null : c.id === 'cash' ? result.cashFull : sum(active.filter(p => p.categoryId === c.id).map(p => p.fullWeight)),
    weight: c.id === 'cash' ? result.cashFractional : sum(active.filter(p => p.categoryId === c.id).map(p => p.weight)),
    pending: result.positions.filter(p => p.categoryId === c.id && p.diagnostic.status === 'pending').map(idOf) }));
  result.categoryWeights = Object.fromEntries(result.categoryDetails.map(c => [c.id, c.weight]));
  result.historyRisk = historicalRisk(result.positions, bundle?.history, warnings);
  if (!result.solver.converged) warnings.push('Solver convergence not established; weights are feasible iterates, not a certified optimum');
  result.status = !result.solver.converged ? 'not-converged' : pending.length ? 'conditional-partial' : 'conditional';
  reportProgress(options, { phase: 'complete', gap: result.solver.gap, converged: result.solver.converged });
  return result;
}
