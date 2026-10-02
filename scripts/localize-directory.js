import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadCategories, validate } from './lib/data.js';
import { digest } from './lib/import.js';

const cachePath = process.argv[2];
if (!cachePath) throw new Error('Usage: node scripts/localize-directory.js <translated.jsonl>');
const raw = fs.readFileSync(cachePath, 'utf8');
const cache = new Map(raw.trim().split('\n').map((line) => { const row = JSON.parse(line); return [row.id, row]; }));
const file = path.join(ROOT, 'data/imported/directory.json');
const records = JSON.parse(fs.readFileSync(file, 'utf8'));
// Spot checks found semantic mistranslations or omitted institution names.
const reviewedRetained = new Set(['wd-q1342528', 'wd-q140356691', 'wd-q18537021', 'wd-q19721395', 'wd-q122032458']);
for (const site of records) {
  if (site.localization?.method === 'source') continue;
  const row = cache.get(site.id);
  if (!row || row.original_name !== site.name || row.source_record !== site.source.record) throw new Error(`Missing or stale translation: ${site.id}`);
  const translated = row.name_zh.trim();
  const retain = reviewedRetained.has(site.id) || !/[\u3400-\u9fff]/.test(translated) || /([\u3400-\u9fff])\1{2,}/.test(translated) || translated.length > 180 || /^[A-Z\d .&-]{2,16}$/.test(site.name);
  site.localization = { original_name: site.name, source_record: site.source.record, input: row.input,
    name_zh: retain ? site.name : translated, method: retain ? 'retained' : 'machine',
    ...(retain ? { review_note: '译名或简称不确定，保留原文，待补充中文名称。' } : {}) };
}
const errors = validate(loadCategories(), records);
if (errors.length) throw new Error(errors.join('\n'));
fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
const coverage = Object.fromEntries(['source', 'machine', 'retained'].map((method) => [method, records.filter((s) => s.localization.method === method).length]));
fs.writeFileSync(path.join(ROOT, 'data/localization/directory-model.json'), JSON.stringify({
  model: 'Helsinki-NLP/opus-mt-en-zh', conversion: 'gaudi/opus-mt-en-zh-ctranslate2',
  revision: 'dcd22168f08b99dd34c62bc2195e31dc2f04e90b', license: 'Apache-2.0',
  engine: 'CTranslate2 4.8.2 / SentencePiece 0.2.2', beam_size: 4, output_sha256: digest(raw), coverage, reviewed_retained_ids: [...reviewedRetained],
  note: '名称参考翻译，保留原名；不构成官方中文名称或官网身份核验。'
}, null, 2) + '\n');
console.log(JSON.stringify(coverage));
