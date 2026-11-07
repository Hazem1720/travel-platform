// Creates one GitHub issue per requirement from docs/requirements/requirements-tracker.csv
// Dry run by default: nothing on GitHub changes unless you pass --apply.
//   node scripts/create-issues.js                    preview, creates nothing
//   node scripts/create-issues.js --apply            create the missing issues (and labels)
//   node scripts/create-issues.js --assign           preview assignees from scripts/usernames.json
//   node scripts/create-issues.js --assign --apply   add those assignees
// scripts/usernames.json (not committed) maps tracker owner names to GitHub usernames,
// e.g. { "Hazem": "Hazem1720" }.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'Hazem1720/travel-platform';
// --dry is still accepted; it is now the default.
const DRY = !process.argv.includes('--apply');
const ASSIGN = process.argv.includes('--assign');

let usernames = {};
const unPath = path.join(__dirname, 'usernames.json');
if (fs.existsSync(unPath)) usernames = JSON.parse(fs.readFileSync(unPath, 'utf8'));

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const rows = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'docs', 'requirements', 'requirements-tracker.csv'), 'utf8'));
const existing = JSON.parse(gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '1000', '--json', 'number,title,assignees']));
const byId = new Map();
for (const i of existing) {
  const m = i.title.match(/^\[([A-Za-z0-9-]+)\]/);
  if (m) byId.set(m[1], i);
}

function labelsFor(r) {
  return [
    r['Type'].toLowerCase(),
    r['Milestone'] === 'M2 only' ? 'm2-only' : 'milestone-1',
    `owner:${r['Owner']}`,
    `module:${slug(r['Module'])}`,
  ];
}

if (!DRY && !ASSIGN) {
  const colors = { mandatory: 'b60205', bonus: 'fbca04', 'milestone-1': '0e8a16', 'm2-only': '5319e7' };
  const all = new Set(rows.flatMap(labelsFor));
  for (const l of all) {
    const color = colors[l] || (l.startsWith('owner:') ? '1d76db' : 'c5def5');
    gh(['label', 'create', l, '--color', color, '--force', '--repo', REPO]);
  }
}

let created = 0, skipped = 0, assigned = 0;
for (const r of rows) {
  const id = r['ID'];
  const short = r['Requirement'].replace(/^The system shall (also )?/i, '').slice(0, 80).replace(/\s+\S*$/, '');
  const title = `[${id}] ${short}...`;
  const owner = r['Owner'];

  if (byId.has(id)) {
    skipped++;
    const issue = byId.get(id);
    const user = usernames[owner];
    if (ASSIGN && user && !issue.assignees.some((a) => a.login === user)) {
      if (!DRY) gh(['issue', 'edit', String(issue.number), '--repo', REPO, '--add-assignee', user]);
      assigned++;
    }
    continue;
  }
  if (ASSIGN) continue;

  const body = [
    '## Requirement',
    r['Requirement'],
    '',
    '## Details',
    `- **ID:** ${id}`,
    `- **Type:** ${r['Type']}`,
    `- **Module:** ${r['Module']}`,
    `- **Actor(s):** ${r['Actor(s)']}`,
    `- **Dependencies:** ${r['Dependencies'] || 'none'}`,
    `- **Complexity:** ${r['Complexity']}`,
    `- **Owner:** ${owner}`,
    `- **Milestone:** ${r['Milestone']}`,
    '',
    '## Acceptance criteria',
    'The requirement text above is the acceptance criteria from the official sheet.',
    '- [ ] Works in Swagger with valid and invalid input',
    '- [ ] Role guard and ownership check (where it applies)',
    '- [ ] Server-side validation and the common error format',
    '- [ ] Tests, or a documented Swagger test',
    '- [ ] PR approved and merged into develop',
    '- [ ] AI_PROMPTS.txt updated',
    '',
    '## Contract (post as a comment before building large features)',
    'Proposed schemas and endpoints. The leader approves before you build.',
  ].join('\n');

  const args = ['issue', 'create', '--repo', REPO, '--title', title, '--body', body];
  for (const l of labelsFor(r)) args.push('--label', l);
  if (usernames[owner]) args.push('--assignee', usernames[owner]);

  if (DRY) console.log('would create:', title, '| labels:', labelsFor(r).join(', '));
  else { gh(args); sleep(1200); console.log('created:', title); }
  created++;
}
console.log(`${DRY ? '(dry run) ' : ''}created: ${created}, already existed: ${skipped}, assigned: ${assigned}`);