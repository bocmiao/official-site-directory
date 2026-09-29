import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCategories, loadSites, validate, buildSearchIndex } from '../scripts/lib/data.js';
import { search, normalizeQuery, extractHost, checkHost } from '../src/search.js';

const index = buildSearchIndex(loadSites());
const top = (q) => search(q, index)[0]?.id;

test('数据校验通过', () => {
  assert.deepEqual(validate(loadCategories(), loadSites()), []);
});

test('校验能发现重复与非法 url', () => {
  const cats = [{ id: 'x' }];
  const base = { name: 'A', description: 'd', aliases: [], domains: [], tags: [], category: 'x', _file: 't' };
  const errors = validate(cats, [
    { ...base, id: 'a', url: 'https://a.com' },
    { ...base, id: 'a', url: 'https://www.a.com/' },
    { ...base, id: 'b', url: 'https://b.com/?from=ad' },
  ]);
  assert.ok(errors.some((e) => e.includes('id 与')));
  assert.ok(errors.some((e) => e.includes('url 与')));
  assert.ok(errors.some((e) => e.includes('查询参数')));
});

test('去掉“官网”等后缀', () => {
  assert.equal(normalizeQuery(' 12306 官网 '), '12306');
  assert.equal(normalizeQuery('微信下载'), '微信');
  assert.equal(normalizeQuery('官网'), '官网');
});

test('名称、别名、拼音、首字母都能搜到', () => {
  assert.equal(top('12306官网'), '12306');
  assert.equal(top('工行'), 'icbc');
  assert.equal(top('学信网'), 'chsi');
  assert.equal(top('xuexinwang'), 'chsi');
  assert.equal(top('zsyh'), 'cmbchina');
  assert.equal(top('四六级'), 'neea');
  assert.equal(top('B站'), 'bilibili');
});

test('识别网址输入', () => {
  assert.equal(extractHost('https://www.12306.cn/index/'), '12306.cn');
  assert.equal(extractHost('kyfw.12306.cn'), 'kyfw.12306.cn');
  assert.equal(extractHost('12306'), null);
  assert.equal(extractHost('中国银行'), null);
});

test('网址鉴别：官方 / 疑似仿冒 / 未收录', () => {
  assert.equal(checkHost('kyfw.12306.cn', index).status, 'official');
  assert.equal(checkHost('12306-cn.com', index).status, 'suspicious');
  assert.equal(checkHost('icbc-com.cn', index).status, 'suspicious');
  assert.equal(checkHost('bocc.cn', index).status, 'suspicious');
  assert.equal(checkHost('example.org', index).status, 'unknown');
});
