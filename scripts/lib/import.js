import { createHash } from 'node:crypto';
import { parseWebUrl } from '../../src/search.js';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
// This key is only for duplicate detection, never for assigning domain trust.
export function identityUrl(value) {
  const url = parseWebUrl(value);
  return url ? url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '') + url.search : null;
}

const clean = (value) => typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
const aliases = (values, name) => [...new Set(values.map(clean).filter((s) => s && s !== name))].slice(0, 20);

export function importCatalog({ casks, universities, universityRevision, retrievedAt, curated = [] }) {
  if (!Array.isArray(casks) || !Array.isArray(universities) || !/^[a-f0-9]{40}$/.test(universityRevision)) throw new Error('Invalid source snapshot');
  const seen = new Set(curated.map((s) => identityUrl(s.url)));
  // Institution acronyms (e.g. a university's short name) must not suppress
  // unrelated software. Homepage deduplication still spans every source.
  const names = new Set(curated.filter((s) => !s.source || s.category === 'software')
    .flatMap((s) => [s.name, ...(s.aliases || [])]).map((s) => clean(s).toLowerCase()));
  const records = [];
  const skipped = {};
  const reject = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  function add(record) {
    const url = parseWebUrl(record.url);
    if (!url || url.search || url.hash || /(^|\.)(example\.(com|org|net)|localhost)$/.test(url.hostname)) return reject('invalid_url');
    if (url.protocol !== 'https:') return reject('http_only_source');
    if (!record.name || record.name.length > 240) return reject('invalid_name');
    const key = identityUrl(url.href);
    if (seen.has(key)) return reject('duplicate_url');
    if (record.category === 'software' && names.has(record.name.toLowerCase())) return reject('curated_name');
    seen.add(key);
    records.push({ ...record, url: url.href, verification_status: 'sourced', collected_at: retrievedAt,
      entries: [], evidence: [] });
  }
  for (const item of [...casks].sort((a, b) => String(a?.token).localeCompare(String(b?.token), 'en'))) {
    if (!item || !/^[a-z0-9][a-z0-9+@._-]*$/.test(item.token || '') || !Array.isArray(item.name)) { reject('invalid_cask'); continue; }
    if (item.disabled || item.deprecated) { reject('inactive_cask'); continue; }
    if (item.token.startsWith('font-')) { reject('font_package'); continue; }
    // Preview/nightly/old versions are not separate website records.
    if (/[@]|-(?:beta|alpha|nightly|canary|dev|preview|insiders|rc)$/.test(item.token)) { reject('version_variant'); continue; }
    if (!/^[a-f0-9]{40}$/.test(item.tap_git_head || '') || !/^Casks\/[a-z0-9/_.@+-]+\.rb$/.test(item.ruby_source_path || '')) { reject('missing_revision'); continue; }
    const name = clean(item.name[0]);
    add({ id: `brew-${item.token.replace(/[^a-z0-9-]/g, '-')}`, name, url: item.homepage,
      description: clean(item.desc) || `${name}（Homebrew 软件目录收录）`,
      aliases: aliases([...item.name.slice(1), item.token, ...(item.old_tokens || [])], name),
      tags: ['软件', 'macOS'], category: 'software', region: 'GLOBAL',
      source: { id: 'homebrew-cask', record: item.token,
        url: `https://github.com/Homebrew/homebrew-cask/blob/${item.tap_git_head}/${item.ruby_source_path}` } });
  }
  for (const item of [...universities].sort((a, b) => `${a?.country}|${a?.name}|${a?.web_pages?.[0]}`.localeCompare(`${b?.country}|${b?.name}|${b?.web_pages?.[0]}`, 'en'))) {
    if (!item || !/^[A-Z]{2}$/.test(item.alpha_two_code || '') || !Array.isArray(item.web_pages)) { reject('invalid_university'); continue; }
    // Keep the source's first usable homepage; one institution, not one row per domain.
    const url = item.web_pages.find((value) => { const u = parseWebUrl(value); return u?.protocol === 'https:' && !u.search && !u.hash; }) || item.web_pages[0];
    const name = clean(item.name);
    const key = `${item.alpha_two_code}|${name}|${identityUrl(url)}`;
    add({ id: `uni-${digest(key).slice(0, 16)}`, name, url,
      description: `${clean(item.country)}${item['state-province'] ? ` · ${clean(item['state-province'])}` : ''} · 高校目录记录，学校资质及网址归属待核实。`,
      aliases: [], tags: ['高校'], category: 'education', region: item.alpha_two_code,
      source: { id: 'hipo-universities', record: `${item.alpha_two_code}: ${name}`,
        url: `https://github.com/Hipo/university-domains-list/blob/${universityRevision}/world_universities_and_domains.json` } });
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (new Set(records.map((s) => s.id)).size !== records.length) throw new Error('Imported ID collision');
  return { records, skipped, input: { casks: casks.length, universities: universities.length } };
}
