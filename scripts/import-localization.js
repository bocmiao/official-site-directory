import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadSites, loadCategories, validate } from './lib/data.js';

const inputDir = process.argv[2];
if (!inputDir) throw new Error('Usage: node scripts/import-localization.js <translation-cache-directory>');
const read = (file) => JSON.parse(fs.readFileSync(path.join(inputDir, file), 'utf8'));
const sourceNames = read('source-names.json');
const mapping = read('wikidata-mapping.json');
const labels = read('wikidata-labels.json');
const machinePath = path.join(inputDir, 'translated-ct2.jsonl');
const machine = new Map(fs.readFileSync(machinePath, 'utf8').trim().split('\n').map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
const editorial = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/localization/editorial.json'), 'utf8'));
const records = {};
const sites = loadSites(undefined, { localization: false });
for (const site of sites.filter((s) => s.category.startsWith('institutions-'))) {
  const base = { original_name: site.name, source_record: site.source.record };
  const row = machine.get(site.id);
  const wiki = labels[mapping[site.id]];
  const zh = ['zh-hans', 'zh-cn', 'zh', 'zh-hant'].map((l) => wiki?.labels?.[l]?.value).find((v) => v && /[\u3400-\u9fff]/.test(v));
  if (sourceNames[site.id] && /[\u3400-\u9fff]/.test(sourceNames[site.id].name_zh)) {
    if (sourceNames[site.id].original_name !== site.name || sourceNames[site.id].source_record !== site.source.record) throw new Error(`Stale source Chinese name: ${site.id}`);
    records[site.id] = { ...sourceNames[site.id], ...base, method: site.source.id === 'hipo-universities' ? 'existing' : 'source' };
  }
  else if (zh && wiki.lastrevid && /^Q\d+$/.test(wiki.id)) records[site.id] = { ...base, name_zh: zh, method: 'wikidata', wikidata_id: wiki.id, wikidata_revision: wiki.lastrevid };
  else if (editorial[site.name] || editorial[row?.input]) records[site.id] = { ...base, name_zh: editorial[site.name] || editorial[row.input], method: 'editorial' };
  else if (row && row.original_name === site.name && row.source_record === site.source.record) {
    let translated = row.name_zh.replace(/(大学|学院|学校|研究所)(?:\1)+/g, '$1').trim();
    const uncertain = !/[\u3400-\u9fff]/.test(translated) || /([\u3400-\u9fff])\1{2,}/.test(translated) || translated.length > 180 || /^[A-Z\d .&-]{2,16}$/.test(row.input);
    records[site.id] = { ...base, name_zh: uncertain ? site.name : translated, method: uncertain ? 'retained' : 'machine', input: row.input,
      ...(uncertain ? { review_note: '简称或译名不确定，保留原名，待补充可靠中文名称。' } : {}) };
  } else throw new Error(`Missing translation: ${site.id}`);
}
const completed = sites.map((s) => records[s.id] ? { ...s, localization: records[s.id] } : s);
const errors = validate(loadCategories(), completed);
if (errors.length) throw new Error(errors.join('\n'));
const counts = Object.fromEntries([...new Set(Object.values(records).map((r) => r.method))].sort().map((m) => [m, Object.values(records).filter((r) => r.method === m).length]));
const payload = { schema_version: 1, collected_at: '2026-09-30', coverage: counts,
  methodology: 'Existing Chinese labels, linked Wikidata labels, editorial reference names, then local machine translation. Never grants official status. Uncertain short names are retained.',
  wikidata: { license: 'CC0-1.0', license_url: 'https://www.wikidata.org/wiki/Wikidata:Licensing', linked_via: 'ROR external_ids[type=wikidata]', cache_sha256: createHash('sha256').update(fs.readFileSync(path.join(inputDir, 'wikidata-labels.json'))).digest('hex') },
  model: { name: 'Helsinki-NLP/opus-mt-en-zh', url: 'https://huggingface.co/Helsinki-NLP/opus-mt-en-zh', conversion: 'gaudi/opus-mt-en-zh-ctranslate2', revision: 'dcd22168f08b99dd34c62bc2195e31dc2f04e90b', engine: 'CTranslate2 4.8.2 / SentencePiece 0.2.2', beam_size: 4, no_repeat_ngram_size: 3, repetition_penalty: 1.05, license: 'Apache-2.0', output_sha256: createHash('sha256').update(fs.readFileSync(machinePath)).digest('hex') }, records };
fs.writeFileSync(path.join(ROOT, 'data/localization/zh-CN.json'), JSON.stringify(payload, null, 2) + '\n');
console.log(JSON.stringify({ total: Object.keys(records).length, coverage: counts }, null, 2));
