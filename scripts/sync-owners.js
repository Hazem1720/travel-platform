// node scripts/sync-owners.js --dry   preview what would change
// node scripts/sync-owners.js         fix owner labels, assignees and the Owner line of each issue
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'Hazem1720/travel-platform';
const DRY = process.argv.includes('--dry');
const unPath = path.join(__dirname, 'usernames.json');
const usernames = fs.existsSync(unPath) ? JSON.parse(fs.readFileSync(unPath, 'utf8')) : {};
const known = new Set(Object.values(usernames));

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

const rows = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'docs', 'requirements', 'requirements-tracker.csv'), 'utf8'));
const issues = JSON.parse(gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '1000', '--json', 'number,title,body,labels,assignees']));
const byId = new Map();
for (const i of issues) {
  const m = i.title.match(/^\[([A-Za-z0-9-]+)\]/);
  if (m) byId.set(m[1], i);
}

let changed = 0;
const missing = [];
for (const r of rows) {
  const issue = byId.get(r['ID']);
  if (!issue) { missing.push(r['ID']); continue; }
  const owner = r['Owner'];
  const wantLabel = `owner:${owner}`;
  const haveOwnerLabels = issue.labels.map((l) => l.name).filter((n) => n.startsWith('owner:'));
  const wantUser = usernames[owner];
  const haveUsers = issue.assignees.map((a) => a.login);

  const labelOk = haveOwnerLabels.length === 1 && haveOwnerLabels[0] === wantLabel;
  const userOk = !wantUser || (haveUsers.includes(wantUser) && haveUsers.every((u) => !known.has(u) || u === wantUser));
  const bodyOk = (issue.body || '').includes(`- **Owner:** ${owner}`);
  if (labelOk && userOk && bodyOk) continue;

  changed++;
  console.log(`${DRY ? 'would fix' : 'fix'}: ${r['ID']} -> ${owner}`);
  if (DRY) continue;

  gh(['label', 'create', wantLabel, '--color', '1d76db', '--force', '--repo', REPO]);
  const args = ['issue', 'edit', String(issue.number), '--repo', REPO, '--add-label', wantLabel];
  for (const l of haveOwnerLabels) if (l !== wantLabel) args.push('--remove-label', l);
  if (wantUser) {
    args.push('--add-assignee', wantUser);
    for (const u of haveUsers) if (known.has(u) && u !== wantUser) args.push('--remove-assignee', u);
  }
  const newBody = (issue.body || '').replace(/- \*\*Owner:\*\* .*/, `- **Owner:** ${owner}`);
  if (newBody !== issue.body) args.push('--body', newBody);
  gh(args);
  sleep(1000);
}
console.log(`${DRY ? '(dry run) ' : ''}fixed: ${changed}, no issue found for: ${missing.length ? missing.join(', ') : 'none'}`);
