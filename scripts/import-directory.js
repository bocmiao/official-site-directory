import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSites, loadCategories, validate } from './lib/data.js';
import { digest, identityUrl } from './lib/import.js';
import { parseWebUrl } from '../src/search.js';

export const BATCHES = {
  tools: ['tools', '网络应用'], social: ['social', '社交网络'], forums: ['social', '网络论坛'], blogs: ['social', '博客内容'],
  gov: ['gov', '政府机构'], education: ['education', '图书馆与学习资源'], finance: ['finance', '银行'],
  telecom: ['telecom', '通信运营'], 'utilities-public': ['telecom', '公共事业服务'], utilities: ['telecom', '能源服务'],
  travel: ['travel', '航空出行'], shopping: ['shopping', '连锁零售'], shops: ['shopping', '网上商店'],
  news: ['news', '报刊资讯'], games: ['games', '电子游戏'], hmt: ['institutions-hmt', '学校与教育机构'],
  devices: ['devices', '电子制造'], 'devices-industry': ['devices', '电子产业'], 'devices-computers': ['devices', '计算机品牌'],
  'devices-industry-tree': ['devices', '电子与硬件产业'], 'devices-phone-models': ['devices', '手机产品'],
  'devices-hardware-models': ['devices', '硬件产品'],
  'tools-databases': ['tools', '数据检索'],
};

export function importDirectory(inputs, existing, date) {
  const seen = new Set(existing.map((s) => identityUrl(s.url)));
  const ids = new Set(existing.map((s) => s.id));
  const names = new Set(existing.map((s) => `${s.region || 'GLOBAL'}|${s.name.toLowerCase().trim()}`));
  const counts = Object.fromEntries(loadCategories().map((c) => [c.id, existing.filter((s) => s.category === c.id).length]));
  const records = [], snapshots = {}, skipped = {};
  const specificSites = new Set(Object.entries(inputs).filter(([batch]) => BATCHES[batch]?.[0] !== 'tools')
    .flatMap(([, rows]) => rows.map((row) => row.item?.value)));
  const reject = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  for (const [batch, rows] of Object.entries(inputs)) {
    if (!BATCHES[batch] || !Array.isArray(rows)) throw new Error(`Unknown or malformed batch: ${batch}`);
    const [category, topic] = BATCHES[batch];
    for (const row of [...rows].sort((a, b) => Number(Boolean(b.zh)) - Number(Boolean(a.zh)) ||
      Number(b.site?.value?.startsWith('https:')) - Number(a.site?.value?.startsWith('https:')) ||
      String(a.item?.value).localeCompare(String(b.item?.value), 'en') || String(a.site?.value).localeCompare(String(b.site?.value), 'en'))) {
      if (counts[category] >= 1000) { reject('category_target_reached'); continue; }
      const qid = row.item?.value?.match(/^https?:\/\/www.wikidata.org\/entity\/(Q[1-9]\d*)$/)?.[1];
      const url = parseWebUrl(row.site?.value);
      const original = (row.en?.value || row.zh?.value || '').normalize('NFKC').trim();
      if (category === 'tools' && (specificSites.has(row.item?.value) || /社交|论坛|論壇|博客|游戏|遊戲|網誌/.test(row.description?.value || ''))) { reject('more_specific_category'); continue; }
      if (category === 'education' && /博物[馆館]|museum/i.test(`${original} ${row.zh?.value || ''}`)) { reject('museum_not_learning_portal'); continue; }
      if (!qid || !original || original.length > 240 || /[\u0000-\u001f\u007f]/.test(original) || !url || url.search || url.hash ||
        /(^|\.)(example\.(com|org|net)|web\.archive\.org|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|wikipedia\.org)$/.test(url.hostname) || /\.(exe|dmg|zip|apk|pdf)$/i.test(url.pathname)) { reject('unsuitable_record'); continue; }
      const id = `wd-${qid.toLowerCase()}`;
      const region = /^[A-Z]{2}$/.test(row.country?.value || '') ? row.country.value : 'GLOBAL';
      if (category === 'institutions-hmt' && !['HK', 'MO', 'TW'].includes(region)) { reject('outside_region'); continue; }
      const nameKey = `${region}|${original.toLowerCase()}`;
      if (ids.has(id) || seen.has(identityUrl(url.href)) || names.has(nameKey)) { reject('duplicate_identity'); continue; }
      const sha256 = digest(JSON.stringify(row));
      const source = { id: 'wikidata-directory', record: qid, url: `https://www.wikidata.org/wiki/${qid}`, batch, sha256 };
      const zh = row.zh?.value?.trim();
      const description = row.description?.value?.trim();
      const year = Number(row.founded?.value?.match(/^(\d{4})-/)?.[1]);
      const profile = { source_record: qid, homepage: url.href, collected_at: date,
        ...(year > 0 && year <= Number(date.slice(0, 4)) ? { established: year } : {}),
        ...(region !== 'GLOBAL' ? { locations: [{ country: region, city: '', subdivision: '' }] } : {}) };
      const record = { id, name: original, aliases: zh && zh !== original ? [zh] : [], url: url.href,
        description: `${description && /[\u3400-\u9fff]/.test(description) ? description.replace(/[。.]$/, '') + '。' : ''}${topic}类目录记录；地址取自维基数据官网字段，归属及当前可用性待核对。`,
        category, region, tags: [topic], source, collected_at: date, profile,
        verification_status: 'sourced', entries: [], evidence: [],
        ...(zh && /[\u3400-\u9fff]/.test(zh) ? { localization: { original_name: original, source_record: qid, name_zh: zh, method: 'source' } } : {}) };
      records.push(record); snapshots[id] = { batch, sha256, row };
      seen.add(identityUrl(url.href)); ids.add(id); names.add(nameKey); counts[category]++;
    }
  }
  return { records, snapshots, counts, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts/import-directory.js')) {
  const inputDir = process.argv[2];
  if (!inputDir) throw new Error('Usage: node scripts/import-directory.js <snapshot-dir> [--dry-run]');
  const date = '2026-09-30';
  const inputs = {}, queries = {};
  for (const batch of Object.keys(BATCHES)) {
    const file = path.join(inputDir, `${batch}.json`);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    inputs[batch] = JSON.parse(raw).results.bindings;
    queries[batch] = { query: fs.readFileSync(`${file}.rq`, 'utf8'), sha256: digest(raw), rows: inputs[batch].length };
  }
  const existing = loadSites().filter((s) => s.source?.id !== 'wikidata-directory');
  const result = importDirectory(inputs, existing, date);
  console.log(JSON.stringify({ added: result.records.length, counts: result.counts, skipped: result.skipped }, null, 2));
  if (!process.argv.includes('--dry-run')) {
    const errors = validate(loadCategories(), [...existing, ...result.records]);
    if (errors.length) throw new Error(errors.join('\n'));
    if (Object.values(result.counts).some((n) => n < 1000)) throw new Error('A category is below 1,000; no data written');
    const dir = path.join(ROOT, 'data/imported');
    fs.writeFileSync(path.join(dir, 'directory.json'), JSON.stringify(result.records, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'directory-evidence.json'), JSON.stringify(result.snapshots) + '\n');
    fs.writeFileSync(path.join(dir, 'directory-source.json'), JSON.stringify({ schema_version: 1, collected_at: date,
      accepted: result.records.length, baseline_count: existing.length, baseline_ids_sha256: digest(existing.map((s) => s.id).sort().join('\n')),
      queries, skipped: result.skipped, sources: [{ id: 'wikidata-directory', name: '维基数据分类目录', url: 'https://www.wikidata.org/',
        download_url: 'https://query.wikidata.org/', license: 'CC0-1.0', license_file: 'wikidata-cc0.txt',
        attribution: '来自 Wikidata 的结构化数据（CC0）；原始官网字段及本次查询快照保留，不等于已完成官网核验。' }] }, null, 2) + '\n');
  }
}
