import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSites, loadCategories, validate, buildSearchIndex } from '../scripts/lib/data.js';
import { displayName, displayDescription, validateLocalization } from '../scripts/lib/localization.js';
import { compareDirectory, queryCatalog, checkHost } from '../src/search.js';

const sites = loadSites();
const index = buildSearchIndex(sites, '2026-09-30');

test('education services are separated from regional institution catalogs without removing records', () => {
  assert.equal(sites.length, 34630);
  assert.deepEqual(sites.filter((s) => s.category === 'education' && !s.source).map((s) => s.id).sort(), ['cet', 'chsi', 'cpta', 'icourse163', 'moe', 'neea', 'ntce', 'smartedu', 'xuetangx', 'yz-chsi']);
  assert.equal(sites.filter((s) => s.category === 'institutions-cn').length, 1785);
  assert.equal(sites.filter((s) => s.category === 'institutions-hmt').length, 1000);
  assert.equal(sites.filter((s) => s.category === 'institutions-global').length, 17044);
  assert.deepEqual(validate(loadCategories(), sites, '2026-09-30'), []);
});

test('all institution records have an explicit name localization policy, retaining original names and trust status', () => {
  for (const s of sites.filter((s) => s.category.startsWith('institutions-'))) {
    assert.ok(validateLocalization(s.localization, s), s.id);
    assert.equal(s.localization.original_name, s.name);
    assert.equal(s.verification_status, 'sourced');
    assert.match(displayDescription(s), /教育机构目录记录/);
    assert.equal(s.entries.length, 0);
  }
  const s = sites.find((s) => s.localization?.method === 'machine');
  assert.equal(validateLocalization({ ...s.localization, original_name: 'Changed upstream' }, s), false);
  assert.equal(validateLocalization({ ...s.localization, verification_status: 'verified' }, s), false);
  assert.notEqual(checkHost(new URL(s.url).hostname, index, '2026-09-30').status, 'matched');
});

test('Chinese names, original names and translated pinyin all find the same institution', () => {
  const harvard = sites.find((s) => s.name === 'Harvard University');
  assert.equal(displayName(harvard), '哈佛大学');
  for (const q of ['哈佛大学', 'Harvard University', 'hafodaxue']) assert.equal(queryCatalog(q, index, { today: '2026-09-30' }).items[0].id, harvard.id);
  const localized = index.find((s) => s.id === harvard.id);
  assert.equal(localized.o, 'Harvard University');
});

test('initial browsing puts curated services before overseas lists; education filter remains accessible', () => {
  const ordered = [...index].sort(compareDirectory);
  const results = queryCatalog('', ordered, { status: 'all', today: '2026-09-30' });
  assert.ok(results.items.every((s) => s.source === 'curated'));
  const exams = queryCatalog('', ordered, { category: 'education', status: 'all', today: '2026-09-30' });
  assert.equal(exams.total, 1000);
  assert.ok(exams.items.filter((s) => s.source === 'curated').every((s) => /[\u3400-\u9fff]/.test(s.n)));
});
