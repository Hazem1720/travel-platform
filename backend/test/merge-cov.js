const lib = require('istanbul-lib-coverage');
const map = lib.createCoverageMap({});
for (const f of ['coverage/coverage-final.json', 'coverage-e2e/coverage-final.json']) {
  try { map.merge(require('../' + f)); console.log('merged', f); } catch (e) { console.log('missing', f, e.message); }
}
const s = map.getCoverageSummary();
console.log('TOTAL lines', s.lines.pct, 'branches', s.branches.pct, 'functions', s.functions.pct);
const rows = [];
for (const file of map.files()) {
  const fc = map.fileCoverageFor(file); const sm = fc.toSummary();
  const unb = []; const b = fc.data.b, bm = fc.data.branchMap;
  for (const k of Object.keys(b)) b[k].forEach((n, i) => { if (!n) unb.push((bm[k].locations[i] || bm[k].loc).start.line); });
  const unl = fc.getUncoveredLines();
  rows.push([file.replace(/.*\/src\//, ''), sm.lines.pct, sm.branches.pct, unl.length, unb.length, [...new Set(unb)].slice(0, 25).join(','), unl.slice(0, 25).join(',')]);
}
rows.sort((a, b) => (b[3] + b[4]) - (a[3] + a[4]));
for (const r of rows.slice(0, 60)) console.log('ROW', r.join(' | '));
