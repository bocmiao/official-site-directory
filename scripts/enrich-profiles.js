import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadSites, loadSources } from './lib/data.js';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/enrich-profiles.js <source-directory>');
const sources = loadSources();
const inputs = [
  ['ror', 'ror-v2.13/v2.13-2026-09-22-ror-data.json', '6d032ff473f771e015da0837fe28b881a8f85822ee7815effefe11dc49c4346c'],
  ['homebrew-cask', 'homebrew-casks.json', 'e6203184b01f0b4aca26a5ba6b1d9b1e95a1504a73564aad37752984cae655cd'],
  ['hipo-universities', 'universities.json', '4c8b526235db4b1c78706608558c497240537fe97cb601003e60464052896fce'],
];
const raw = {};
for (const [id, file, expected] of inputs) {
  const bytes = fs.readFileSync(path.resolve(directory, file));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Snapshot hash mismatch: ${file}`);
  raw[id] = JSON.parse(bytes);
}
const ror = new Map(raw.ror.map((r) => [r.id, r]));
const casks = new Map(raw['homebrew-cask'].map((r) => [r.token, r]));
const universities = new Map(raw['hipo-universities'].flatMap((r) => (r.web_pages || []).map((url) => [url.replace(/\/$/, ''), r])));
const records = {};
for (const s of loadSites(ROOT + '/data', { profiles: false })) {
  if (!s.source || !inputs.some(([id]) => id === s.source.id)) continue;
  const profile = { source_record: s.source.record, homepage: s.url, collected_at: s.collected_at };
  if (s.source.id === 'ror') {
    const r = ror.get(s.source.record);
    if (!r) throw new Error(`Missing source record: ${s.id}`);
    if (Number.isInteger(r.established) && r.established > 0 && r.established <= 2026) profile.established = r.established;
    profile.locations = r.locations.map(({ geonames_details: g }) => ({ country: g.country_code, city: g.name, subdivision: g.country_subdivision_name || '' }));
    profile.organization_types = r.types;
    profile.name_languages = [...new Set(r.names.map((n) => n.lang).filter(Boolean))].sort();
    profile.source_updated = r.admin.last_modified.date;
    profile.identifiers = r.external_ids.filter((v) => ['wikidata', 'isni', 'fundref', 'grid'].includes(v.type))
      .flatMap((v) => v.all.map((value) => ({ scheme: v.type, value })));
  } else if (s.source.id === 'homebrew-cask') {
    const r = casks.get(s.source.record);
    if (!r) throw new Error(`Missing cask record: ${s.id}`);
    profile.distribution = 'Homebrew Cask';
    profile.cask_languages = r.languages || [];
    if (typeof r.version === 'string') profile.package_version = r.version;
    // Cask platform metadata is package scope, not a complete list of vendor OS support.
    if (r.supported_platforms?.some((p) => !p.includes('linux'))) profile.package_platforms = ['macOS'];
  } else {
    const r = universities.get(s.url.replace(/\/$/, ''));
    if (r?.['state-province']) profile.locations = [{ country: r.alpha_two_code, subdivision: r['state-province'], city: '' }];
  }
  records[s.id] = profile;
}
const output = { schema_version: 1, note: 'Fields are third-party source metadata, not website verification. See docs/TAXONOMY.md.',
  snapshots: inputs.map(([id, file, sha256]) => ({ id, file, sha256, source: sources.sources.find((s) => s.id === id)?.url })), records };
fs.writeFileSync(path.join(ROOT, 'data/profiles.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`Enriched ${Object.keys(records).length} profiles from hash-verified snapshots.`);
