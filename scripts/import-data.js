import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSites, loadCategories, validate } from './lib/data.js';
import { digest, importCatalog } from './lib/import.js';

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const dir = path.join(ROOT, 'data', 'imported');
const lockPath = path.join(dir, 'sources.json');
const locked = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
const date = option('--date') || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid --date');
let revision = option('--university-revision') || locked?.sources.find((s) => s.id === 'hipo-universities')?.revision;
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'official-site-directory-import' } });
  if (!response.ok) throw new Error(`Source download failed: ${response.status} ${url}`);
  return response.text();
}
if (args.includes('--refresh')) {
  revision = JSON.parse(await download('https://api.github.com/repos/Hipo/university-domains-list/commits/master')).sha;
}
if (!revision) throw new Error('Provide --university-revision or use --refresh');
const caskUrl = 'https://formulae.brew.sh/api/cask.json';
const universityUrl = `https://raw.githubusercontent.com/Hipo/university-domains-list/${revision}/world_universities_and_domains.json`;
if (!args.includes('--refresh') && (!option('--casks') || !option('--universities'))) throw new Error('Use --refresh for network import, or provide --casks and --universities snapshot paths');
const caskText = option('--casks') ? fs.readFileSync(option('--casks'), 'utf8') : await download(caskUrl);
const universityText = option('--universities') ? fs.readFileSync(option('--universities'), 'utf8') : await download(universityUrl);
// Other import batches and manually curated rows remain intact and win deduplication.
const curated = loadSites().filter((s) => s._file !== 'data/imported/catalog.json');
const result = importCatalog({ casks: JSON.parse(caskText), universities: JSON.parse(universityText), universityRevision: revision, retrievedAt: date, curated });
const overridePath = path.join(ROOT, 'data', 'overrides.json');
const overrides = fs.existsSync(overridePath) ? JSON.parse(fs.readFileSync(overridePath, 'utf8')) : {};
const proposedIds = new Set([...curated, ...result.records].map((s) => s.id));
for (const id of Object.keys(overrides)) if (!proposedIds.has(id)) throw new Error(`Source removed an overridden record (${id}); preserve it in data/sites before refreshing. No data written.`);
const errors = validate(loadCategories(), [...curated, ...result.records.map((s) => ({ ...s, ...overrides[s.id] }))]);
if (errors.length) throw new Error(errors.join('\n'));
if (result.records.length < 2000) throw new Error('Import unexpectedly below 2,000 records; no data written');
const previousCount = locked?.accepted || 0;
if (previousCount && result.records.length < previousCount * 0.8 && !args.includes('--allow-large-drop')) throw new Error('Import would remove over 20% of records; inspect source and use --allow-large-drop only after review');
const manifest = { schema_version: 1, collected_at: date, accepted: result.records.length,
  input: result.input, skipped: result.skipped, sources: [
    { id: 'homebrew-cask', name: 'Homebrew Cask', url: 'https://github.com/Homebrew/homebrew-cask', download_url: caskUrl,
      sha256: digest(caskText), license: 'BSD-2-Clause', license_file: 'homebrew-cask.txt',
      revisions: [...new Set(JSON.parse(caskText).map((s) => s.tap_git_head))].sort() },
    { id: 'hipo-universities', name: 'Hipo University Domains List', url: 'https://github.com/Hipo/university-domains-list',
      download_url: universityUrl, sha256: digest(universityText), license: 'MIT', license_file: 'hipo-universities.txt', revision },
  ] };
const content = JSON.stringify(result.records, null, 2) + '\n';
const changed = !fs.existsSync(path.join(dir, 'catalog.json')) || fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8') !== content;
if (!args.includes('--dry-run')) {
  fs.mkdirSync(dir, { recursive: true });
  // All downloads, normalization, schema and count checks finish before replacing snapshots.
  fs.writeFileSync(path.join(dir, 'catalog.json'), content);
  fs.writeFileSync(lockPath, JSON.stringify(manifest, null, 2) + '\n');
}
console.log(JSON.stringify({ dry_run: args.includes('--dry-run'), changed, accepted: manifest.accepted, total: curated.length + manifest.accepted, skipped: result.skipped }, null, 2));
