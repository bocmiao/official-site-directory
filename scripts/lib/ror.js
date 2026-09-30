import { identityUrl } from './import.js';
import { parseWebUrl } from '../../src/search.js';

const clean = (value) => typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
const nameKey = (name, region) => `${region}|${clean(name).toLowerCase().replace(/[\s\p{P}]/gu, '')}`;

export function importRor({ organizations, existing = [], snapshot, date }) {
  if (!Array.isArray(organizations) || !/^https:\/\/zenodo\.org\/records\/[1-9]\d*$/.test(snapshot)) throw new Error('Invalid ROR snapshot');
  const urls = new Set(existing.map((s) => identityUrl(s.url)));
  const names = new Set(existing.flatMap((s) => [s.name, ...(s.aliases || [])].map((n) => nameKey(n, s.region || ''))));
  const ids = new Set(existing.map((s) => s.source?.record).filter((r) => /^https:\/\/ror\.org\//.test(r || '')));
  const records = [];
  const skipped = {};
  const reject = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  for (const org of [...organizations].sort((a, b) => String(a?.id).localeCompare(String(b?.id), 'en'))) {
    if (!org || !/^https:\/\/ror\.org\/0[a-z0-9]{6}\d{2}$/.test(org.id || '') || !Array.isArray(org.names) || !Array.isArray(org.types)) { reject('invalid_record'); continue; }
    if (org.status !== 'active') { reject('inactive'); continue; }
    if (!org.types.includes('education')) { reject('outside_education_scope'); continue; }
    const targets = (Array.isArray(org.links) ? org.links : []).filter((l) => l?.type === 'website').map((l) => parseWebUrl(l.value));
    const url = targets.find((u) => u?.protocol === 'https:' && !u.search && !u.hash && !/(^|\.)example\.(com|org|net)$/.test(u.hostname));
    if (!url) { reject('no_https_homepage'); continue; }
    // Use a source-supplied Chinese label when available, never translate/guess institution identity.
    const label = org.names.find((n) => n?.lang === 'zh' && n.types?.includes('label')) || org.names.find((n) => n?.types?.includes('ror_display'));
    const name = clean(label?.value);
    const aliases = [...new Set(org.names.map((n) => clean(n?.value)).filter((n) => n && n !== name))];
    if (!name || name.length > 240) { reject('invalid_name'); continue; }
    const regions = [...new Set((org.locations || []).map((l) => l?.geonames_details?.country_code).filter((r) => /^[A-Z]{2}$/.test(r || '')))];
    const region = regions.length === 1 ? regions[0] : 'GLOBAL';
    const key = identityUrl(url.href);
    if (urls.has(key)) { reject('duplicate_homepage'); continue; }
    const keys = [name, ...aliases].filter((n) => n.length >= 4).map((n) => nameKey(n, region));
    if (keys.some((k) => names.has(k))) { reject('duplicate_name_in_region'); continue; }
    if (ids.has(org.id)) { reject('duplicate_ror_id'); continue; }
    urls.add(key); keys.forEach((k) => names.add(k)); ids.add(org.id);
    records.push({ id: `ror-${org.id.split('/').at(-1)}`, name, url: url.href, aliases,
      description: 'ROR 教育与研究机构目录记录；网址归属及机构资质尚未独立核验。',
      category: 'education', tags: ['教育', '研究机构'], region,
      source: { id: 'ror', record: org.id, url: org.id, snapshot },
      verification_status: 'sourced', collected_at: date, entries: [], evidence: [] });
  }
  return { records, input: organizations.length, skipped };
}
