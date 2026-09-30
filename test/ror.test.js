import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSites, loadCategories, validate, buildSearchIndex } from '../scripts/lib/data.js';
import { importRor } from '../scripts/lib/ror.js';
import { digest } from '../scripts/lib/import.js';
import { queryCatalog, checkHost } from '../src/search.js';

const snapshot = 'https://zenodo.org/records/22902037';
const date = '2026-09-30';
const fixture = (suffix, overrides = {}) => ({ id: `https://ror.org/0abcde${suffix}12`, status: 'active', types: ['education'],
  names: [{ value: `School ${suffix}`, types: ['ror_display'], lang: 'en' }],
  links: [{ type: 'website', value: `https://school-${suffix}.edu/` }],
  locations: [{ geonames_details: { country_code: 'CN' } }], ...overrides });
const run = (organizations, existing = []) => importRor({ organizations, existing, snapshot, date });

test('ROR batch adds at least 10,000 distinct records above the preserved 4,943 baseline', () => {
  const sites = loadSites();
  const base = sites.filter((s) => s.source?.id !== 'ror');
  const added = sites.filter((s) => s.source?.id === 'ror');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/imported/ror-source.json')));
  assert.equal(base.length, 4943);
  assert.equal(digest(base.map((s) => s.id).sort().join('\n')), manifest.baseline_ids_sha256);
  assert.equal(manifest.baseline_count, base.length);
  assert.ok(added.length >= 10000);
  assert.equal(sites.length - base.length, added.length);
  assert.equal(manifest.accepted, added.length);
  assert.equal(manifest.input, manifest.accepted + Object.values(manifest.skipped).reduce((a, b) => a + b, 0));
  assert.deepEqual(validate(loadCategories(), sites, date), []);
  assert.ok(added.filter((s) => s.region === 'CN').length >= 1000);
});

test('ROR accepts only active education website links with HTTPS; never infers URL from domains or Wikipedia', () => {
  const records = [fixture('1'), fixture('2', { status: 'inactive' }), fixture('3', { types: ['company'] }),
    fixture('4', { links: [{ type: 'website', value: 'http://school-4.edu/' }] }),
    fixture('5', { links: [{ type: 'wikipedia', value: 'https://en.wikipedia.org/wiki/Test' }], domains: ['school-5.edu'] }),
    fixture('6', { links: [{ type: 'website', value: 'https://u:p@school-6.edu/' }] }), null];
  const result = run(records);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].verification_status, 'sourced');
  assert.deepEqual(result.records[0].evidence, []);
  assert.equal(result.skipped.no_https_homepage, 3);
  assert.deepEqual(run([...records].reverse()), result);
});

test('ROR de-duplicates homepage and same-region name against all existing source batches', () => {
  const one = fixture('1');
  const two = fixture('2', { names: one.names });
  assert.equal(run([one, two]).records.length, 1);
  const existing = [{ id: 'existing', name: 'Other name', aliases: [], url: 'http://www.school-1.edu/', region: 'CN' }];
  assert.equal(run([one], existing).skipped.duplicate_homepage, 1);
  existing[0].name = 'School 2';
  assert.equal(run([two], existing).records.length, 1);
  existing[0].name = 'School 1';
  assert.equal(run([two], existing).skipped.duplicate_name_in_region, 1);
});

test('ROR preserves source-supplied Chinese names and exposes multilingual aliases without granting trust', () => {
  const one = fixture('1', { names: [{ value: 'Test University', lang: 'en', types: ['ror_display'] }, { value: '测试大学', lang: 'zh', types: ['label'] }] });
  const record = run([one]).records[0];
  assert.equal(record.name, '测试大学');
  assert.deepEqual(record.aliases, ['Test University']);
  const index = buildSearchIndex([record], date);
  assert.equal(queryCatalog('ceshidaxue', index, { today: date }).total, 1);
  assert.equal(queryCatalog('Test University', index, { today: date }).total, 1);
  assert.equal(checkHost('school-1.edu', index, date).status, 'unknown');
  record.source.snapshot = 'https://zenodo.org/records/latest';
  assert.ok(validate(loadCategories(), [record], date).length);
});
