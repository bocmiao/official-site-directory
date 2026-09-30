import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSites, buildSearchIndex } from '../scripts/lib/data.js';
import { classify } from '../scripts/lib/taxonomy.js';
import { queryCatalog, search, checkHost } from '../src/search.js';

const today = '2026-09-30';
const sites = loadSites();
const index = buildSearchIndex(sites, today);
const find = (query, options = {}) => queryCatalog(query, index, { status: 'all', today, ...options });

test('four discovery categories expose useful services without institution imports', () => {
  for (const [category, count] of [['education', 10], ['tools', 6], ['news', 7], ['games', 9]]) {
    const result = find('', { category });
    assert.equal(result.total, count);
    assert.ok(result.items.every((s) => s.source === 'curated' && s.c === category));
  }
  assert.equal(sites.find((s) => s.id === 'steam').category, 'games');
  for (const category of ['education', 'tools', 'news', 'games']) {
    for (const s of sites.filter((s) => s.category === category)) assert.deepEqual(classify(s), s, s.id);
  }
});

test('Chinese task phrases and equivalents find the intended site', () => {
  for (const [query, id] of [['四六级报名', 'cet'], ['四级查分', 'cet'], ['教师资格证报名', 'ntce'],
    ['研究生报名', 'yz-chsi'], ['网课', 'icourse163'], ['PDF 转换', 'ilovepdf'],
    ['压缩图片', 'tinypng'], ['科技新闻', 'ithome'], ['手游', 'taptap'], ['小游戏', '4399']]) {
    assert.equal(find(query).items[0]?.id, id, query);
  }
  assert.ok(find('游戏商店', { category: 'games' }).items.some((s) => s.id === 'steam'));
  assert.equal(find('游戏平台', { category: 'education' }).total, 0);
  assert.equal(find('网课', { status: 'verified' }).total, 0);
});

test('multiple keywords intersect fields and unknown terms cannot widen the search', () => {
  assert.equal(find('游戏 新闻').items[0]?.id, 'gcores');
  assert.equal(find('新闻 游戏').items[0]?.id, 'gcores');
  assert.equal(find('PDF 不存在的词').total, 0);
  assert.equal(find('  ').total, index.length);
});

test('exact product matches rank above weak verified matches, without granting trust', () => {
  const fixture = (id, v, n, d) => ({ id, v, n, d, a: [], h: [], p: [], t: [], u: 'https://example.org/', due: '2026-12-29' });
  const fixtures = [fixture('generic', 'verified', 'Generic', 'Example tool'), fixture('exact', 'pending', 'Example', 'Product')];
  assert.equal(search('Example', fixtures, { includePending: true, today })[0].id, 'exact');
  assert.equal(search('Example', fixtures, { today })[0].id, 'generic');
  for (const s of sites.filter((s) => s.collected_at === today && !s.source)) {
    const row = index.find((r) => r.id === s.id);
    assert.equal(row.v, 'pending');
    assert.deepEqual(row.e, []);
    assert.equal(checkHost(new URL(s.url).hostname, index, today).status, 'unknown');
    assert.ok(s.evidence.length);
  }
});
