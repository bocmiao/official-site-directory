import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSites, loadCategories, validate } from './lib/data.js';
import { digest } from './lib/import.js';
import { importRor } from './lib/ror.js';

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const file = option('--file');
const snapshot = option('--snapshot');
const expectedHash = option('--sha256');
const date = option('--date') || new Date().toISOString().slice(0, 10);
if (!file || !snapshot || !/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('Provide --file, --snapshot (Zenodo record URL), and --sha256 for the extracted JSON');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
const raw = fs.readFileSync(file);
if (digest(raw) !== expectedHash) throw new Error('ROR JSON SHA-256 mismatch; nothing written');
const before = loadSites();
const base = before.filter((s) => s._file !== 'data/imported/ror.json');
const result = importRor({ organizations: JSON.parse(raw), existing: base, snapshot, date });
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/overrides.json'), 'utf8'));
const ids = new Set([...base, ...result.records].map((s) => s.id));
for (const id of Object.keys(overrides)) if (!ids.has(id)) throw new Error(`Source removed edited record ${id}; preserve it in the curated directory before importing`);
const proposed = [...base, ...result.records.map((s) => ({ ...s, ...overrides[s.id] }))];
const errors = validate(loadCategories(), proposed);
if (errors.length) throw new Error(errors.join('\n'));
if (result.records.length < 10000) throw new Error('ROR batch below 10,000 unique records; nothing written');
const old = before.filter((s) => s._file === 'data/imported/ror.json');
if (old.length && result.records.length < old.length * 0.8) throw new Error('ROR import would remove over 20%; inspect source before proceeding');
const beforeIds = new Set(before.map((s) => s.id));
const afterIds = new Set(proposed.map((s) => s.id));
const removed = before.filter((s) => !afterIds.has(s.id));
const added = proposed.filter((s) => !beforeIds.has(s.id));
const metadata = { schema_version: 1, collected_at: date, accepted: result.records.length, input: result.input, skipped: result.skipped,
  baseline_count: base.length, baseline_ids_sha256: digest(base.map((s) => s.id).sort().join('\n')),
  sources: [{ id: 'ror', name: 'Research Organization Registry (ROR)', url: 'https://ror.org/', snapshot,
    download_url: snapshot, sha256: expectedHash, source_file: path.basename(file),
    license: 'CC0-1.0; country metadata CC-BY-4.0', license_file: 'ror-cc0.txt',
    additional_license_files: ['geonames-cc-by-4.0.txt'],
    attribution: 'Research Organization Registry; country codes derived from GeoNames (https://www.geonames.org), CC BY 4.0. Only country codes retained; other location fields omitted.' }] };
const dir = path.join(ROOT, 'data/imported');
const content = JSON.stringify(result.records, null, 2) + '\n';
const changed = !fs.existsSync(path.join(dir, 'ror.json')) || fs.readFileSync(path.join(dir, 'ror.json'), 'utf8') !== content;
if (!args.includes('--dry-run')) {
  fs.writeFileSync(path.join(dir, 'ror.json'), content);
  fs.writeFileSync(path.join(dir, 'ror-source.json'), JSON.stringify(metadata, null, 2) + '\n');
}
console.log(JSON.stringify({ dry_run: args.includes('--dry-run'), changed, before: before.length, total: proposed.length, added: added.length, removed: removed.length, net_added: proposed.length - before.length, ror: result.records.length, skipped: result.skipped }, null, 2));
