"""Copy the team columns of requirements-tracker.csv into requirements-tracker.xlsx.

    python scripts/sync-tracker-xlsx.py           report what would change, write nothing
    python scripts/sync-tracker-xlsx.py --apply   write the .xlsx

The CSV is the source. The script updates:
  - Tracker sheet: Status, Issue / PR link, Test evidence, Blocker / notes (columns J to M)
  - each owner's sheet: Status
  - Summary sheet: the per-member counts and the Total row
It never edits the official columns or Owner / Milestone. If any of those differ between the
CSV and the Tracker sheet, or a row sits on the wrong owner's sheet, it stops and says so: move
the row by hand first. Two PRs that both change the tracker conflict in the binary .xlsx; resolve
by taking either side's .xlsx, merging the CSV by hand, then running this script with --apply.
Standard library only (no openpyxl), so it runs on any Python 3.8+.
"""
import csv
import html
import os
import re
import sys
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'requirements')
CSV_PATH = os.path.join(ROOT, 'requirements-tracker.csv')
XLSX_PATH = os.path.join(ROOT, 'requirements-tracker.xlsx')
STATUSES = ['Done', 'In Review', 'In Progress', 'Not Started']
TEAM_COLUMNS = ['Status', 'Issue / PR link', 'Test evidence', 'Blocker / notes']

CELL = re.compile(r'<c r="([A-Z]+)(\d+)"((?:\s+[\w:]+="[^"]*")*)\s*(?:/>|>(.*?)</c>)', re.S)
ROW = re.compile(r'<row r="(\d+)"[^>]*?(?:/>|>(.*?)</row>)', re.S)


def cell_text(inner):
    if inner is None:
        return ''
    parts = re.findall(r'<t(?:\s[^>]*)?>(.*?)</t>', inner, re.S)
    if parts:
        return html.unescape(''.join(parts))
    v = re.search(r'<v>(.*?)</v>', inner, re.S)
    return html.unescape(v.group(1)) if v else ''


def style_of(attrs):
    m = re.search(r'\ss="(\d+)"', attrs)
    return f' s="{m.group(1)}"' if m else ''


def text_cell(ref, attrs, value):
    if value == '':
        return f'<c r="{ref}"{style_of(attrs)} t="n" />'
    space = ' xml:space="preserve"' if value != value.strip() or '\n' in value else ''
    return f'<c r="{ref}"{style_of(attrs)} t="inlineStr"><is><t{space}>{html.escape(value, quote=False)}</t></is></c>'


def number_cell(ref, attrs, value):
    return f'<c r="{ref}"{style_of(attrs)} t="n"><v>{value}</v></c>'


def read_rows(xml):
    """{row number: {column letter: (attrs, text)}}"""
    rows = {}
    for rm in ROW.finditer(xml):
        cells = {}
        for cm in CELL.finditer(rm.group(2) or ''):
            cells[cm.group(1)] = (cm.group(3), cell_text(cm.group(4)))
        rows[int(rm.group(1))] = cells
    return rows


def set_cells(xml, updates, make_cell):
    """updates: {(column, row): value}. Replaces existing cells only."""
    done = set()

    def repl(m):
        key = (m.group(1), int(m.group(2)))
        if key not in updates:
            return m.group(0)
        done.add(key)
        return make_cell(m.group(1) + m.group(2), m.group(3), updates[key])

    xml = CELL.sub(repl, xml)
    missing = set(updates) - done
    if missing:
        sys.exit(f'cells not found in the sheet: {sorted(missing)}')
    return xml


def sheet_paths(z):
    wb = z.read('xl/workbook.xml').decode('utf-8')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    targets = dict(re.findall(r'<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"', rels))
    targets.update({k: v for v, k in re.findall(r'<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"', rels)})
    out = {}
    for name, rid in re.findall(r'<sheet name="([^"]+)"[^>]*?r:id="([^"]+)"', wb):
        t = targets[rid].lstrip('/')
        out[html.unescape(name)] = t if t.startswith('xl/') else 'xl/' + t
    return out


def header_columns(rows):
    return {text: col for col, (_, text) in rows[1].items()}


def main():
    apply = '--apply' in sys.argv
    with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        csv_header = reader.fieldnames
        tracker = {r['ID']: r for r in reader}

    z = zipfile.ZipFile(XLSX_PATH)
    infos = z.infolist()
    data = {i.filename: z.read(i.filename) for i in infos}
    z.close()
    paths = sheet_paths(zipfile.ZipFile(XLSX_PATH))
    changes = []

    # Tracker sheet
    tpath = paths['Tracker']
    xml = data[tpath].decode('utf-8')
    rows = read_rows(xml)
    cols = header_columns(rows)
    if list(cols) != csv_header:
        sys.exit(f'Tracker sheet header {list(cols)} does not match the CSV header {csv_header}')
    seen, updates = set(), {}
    for n, cells in rows.items():
        if n == 1 or 'A' not in cells or not cells['A'][1]:
            continue
        rid = cells['A'][1]
        if rid not in tracker:
            sys.exit(f'{rid} is on the Tracker sheet but not in the CSV')
        seen.add(rid)
        for name, col in cols.items():
            have = cells.get(col, ('', ''))[1]
            want = tracker[rid][name]
            if have == want:
                continue
            if name not in TEAM_COLUMNS:
                sys.exit(f'{rid} {name} differs between the CSV and the Tracker sheet; fix it by hand first')
            updates[(col, n)] = want
            changes.append(f'Tracker {rid} {name}: {have!r} -> {want!r}')
    if set(tracker) != seen:
        sys.exit(f'in the CSV but not on the Tracker sheet: {sorted(set(tracker) - seen)}')
    data[tpath] = set_cells(xml, updates, text_cell).encode('utf-8')

    # Owner sheets
    owners = [name for name in paths if name not in ('Summary', 'Tracker')]
    for owner in owners:
        p = paths[owner]
        xml = data[p].decode('utf-8')
        rows = read_rows(xml)
        cols = header_columns(rows)
        id_col, status_col = cols['ID'], cols['Status']
        listed, updates = set(), {}
        for n, cells in rows.items():
            if n == 1 or id_col not in cells or not cells[id_col][1]:
                continue
            rid = cells[id_col][1]
            listed.add(rid)
            have = cells.get(status_col, ('', ''))[1]
            want = tracker[rid]['Status']
            if have != want:
                updates[(status_col, n)] = want
                changes.append(f'{owner} {rid} Status: {have!r} -> {want!r}')
        expected = {rid for rid, r in tracker.items() if r['Owner'] == owner}
        if listed != expected:
            sys.exit(f'{owner} sheet rows do not match the CSV owners: extra {sorted(listed - expected)}, '
                     f'missing {sorted(expected - listed)}; move the rows by hand first')
        data[p] = set_cells(xml, updates, text_cell).encode('utf-8')

    # Summary sheet
    spath = paths['Summary']
    xml = data[spath].decode('utf-8')
    rows = read_rows(xml)
    header_row = next(n for n, c in rows.items() if c.get('A', ('', ''))[1] == 'Member')
    cols = {text: col for col, (_, text) in rows[header_row].items()}
    updates = {}
    totals = dict.fromkeys(['Mandatory', 'Bonus', 'Bonus done'] + STATUSES, 0)
    total_row = None
    for n in sorted(rows):
        if n <= header_row or 'A' not in rows[n]:
            continue
        member = rows[n]['A'][1]
        if member == 'Total':
            total_row = n
            break
        mine = [r for r in tracker.values() if r['Owner'] == member]
        counts = {
            'Mandatory': sum(r['Type'] == 'Mandatory' for r in mine),
            'Bonus': sum(r['Type'] == 'Bonus' for r in mine),
            'Bonus done': sum(r['Type'] == 'Bonus' and r['Status'] == 'Done' for r in mine),
        }
        for s in STATUSES:
            counts[s] = sum(r['Type'] == 'Mandatory' and r['Status'] == s for r in mine)
        for k, v in counts.items():
            totals[k] += v
        counts['% mandatory done'] = counts['Done'] / counts['Mandatory'] if counts['Done'] else 0
        for k, v in counts.items():
            updates[(cols[k], n)] = v
    totals['% mandatory done'] = totals['Done'] / totals['Mandatory'] if totals['Done'] else 0
    for k, v in totals.items():
        updates[(cols[k], total_row)] = v
    counted = {r['ID'] for r in tracker.values()
               if any(rows[n]['A'][1] == r['Owner'] for n in rows if header_row < n < total_row and 'A' in rows[n])}
    if counted != set(tracker):
        sys.exit(f'owners with no Summary row: {sorted({tracker[i]["Owner"] for i in set(tracker) - counted})}')
    for (col, n), v in list(updates.items()):
        have = rows[n].get(col, ('', ''))[1]
        if have != repr(v):
            changes.append(f'Summary {rows[n]["A"][1]} {col}: {have} -> {v!r}')
        else:
            del updates[(col, n)]
    data[spath] = set_cells(xml, {k: repr(v) for k, v in updates.items()}, number_cell).encode('utf-8')

    print('\n'.join(changes) if changes else 'The .xlsx already matches the CSV.')
    if apply and changes:
        tmp = XLSX_PATH + '.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as out:
            for info in infos:
                out.writestr(info, data[info.filename], compress_type=zipfile.ZIP_DEFLATED)
        os.replace(tmp, XLSX_PATH)
        print(f'Wrote {len(changes)} changes to {os.path.relpath(XLSX_PATH)}')
    elif changes:
        print('Dry run: pass --apply to write them.')


if __name__ == '__main__':
    main()
