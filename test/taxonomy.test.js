import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSites, loadCategories, validate, buildSearchIndex } from '../scripts/lib/data.js';
import { classify } from '../scripts/lib/taxonomy.js';
import { queryCatalog, checkHost } from '../src/search.js';

const sites = loadSites();
const index = buildSearchIndex(sites, '2026-09-30');

test('reference classification preserves identity and ambiguous records have a fallback', () => {
  const s = { id: 'example', category: 'software', name: 'Example', aliases: [], description: 'A web browser', tags: [], verification_status: 'sourced' };
  assert.equal(classify(s).subcategory, 'browser');
  assert.equal(classify({ ...s, description: 'Example application' }).subcategory, 'software-other');
  assert.equal(classify(s).verification_status, 'sourced');
  assert.deepEqual(classify(classify(s)), classify(s));
  assert.ok(sites.every((s) => s.subcategory && s.tags.length));
});

test('source profiles preserve factual provenance without asserting website language or verification', () => {
  const tsinghua = sites.find((s) => s.id === 'ror-03cve4549');
  assert.equal(tsinghua.profile.established, 1911);
  assert.equal(tsinghua.profile.locations[0].city, 'Beijing');
  assert.ok(tsinghua.profile.name_languages.includes('zh'));
  assert.equal(tsinghua.verification_status, 'sourced');
  assert.equal(checkHost('www.tsinghua.edu.cn', index, '2026-09-30').status, 'unknown');
  const corrupt = structuredClone(tsinghua);
  corrupt.profile.verified_at = '2026-09-30';
  assert.ok(validate(loadCategories(), [corrupt], '2026-09-30').some((e) => e.includes('未知字段')));
  corrupt.profile = { ...tsinghua.profile, homepage: 'https://different.org/' };
  assert.ok(validate(loadCategories(), [corrupt], '2026-09-30').some((e) => e.includes('不一致')));
});

test('topic, source and tag filters intersect before pagination; locations are searchable', () => {
  const result = queryCatalog('', index, { category: 'software', subcategory: 'browser', tag: '浏览与搜索', source: 'homebrew-cask', sort: 'name', pageSize: 100, today: '2026-09-30' });
  assert.ok(result.total > 5);
  assert.ok(result.items.every((s) => s.sc === 'browser' && s.source === 'homebrew-cask' && s.t.includes('浏览与搜索')));
  assert.deepEqual(result.items.map((s) => s.n), result.items.map((s) => s.n).sort((a, b) => a.localeCompare(b, 'zh-CN')));
  assert.equal(queryCatalog('', index, { category: 'education', subcategory: 'browser' }).total, 0);
  assert.ok(queryCatalog('Beijing', index, { region: 'CN', pageSize: 100 }).total > 10);
});
