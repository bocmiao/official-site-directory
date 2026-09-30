import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCategories, loadSites, validate, buildSearchIndex } from '../scripts/lib/data.js';
import { search, normalizeQuery, extractHost, checkHost, resolveInput, preferredEntry, effectiveStatus, parseWebUrl } from '../src/search.js';

const today = '2026-09-30';
const sites = loadSites();
const index = buildSearchIndex(sites, today);
const options = { today };
const top = (q, includePending = false) => search(q, index, { ...options, includePending })[0]?.id;
const valid = () => structuredClone(sites.find((s) => s.id === 'python'));
const invalid = (change) => { const site = valid(); change(site); return validate(loadCategories(), [site], today); };

test('seed records validate; every verified entry has evidence, a method and review dates', () => {
  assert.deepEqual(validate(loadCategories(), sites, today), []);
  assert.equal(sites.filter((s) => s.verification_status === 'verified').length, 5);
  assert.equal(sites.filter((s) => s.verification_status === 'pending').length, 57);
  assert.ok(invalid((s) => { s.evidence = []; }).some((e) => e.includes('evidence')));
  assert.ok(invalid((s) => { s.entries.push({ ...s.entries[0], id: 'new', url: 'https://new.python.org/' }); }).some((e) => e.includes('缺少核验证据')));
  assert.ok(invalid((s) => { s.verified_at = '2027-01-01'; }).length);
  assert.ok(invalid((s) => { s.review_due_at = '2026-02-30'; }).length);
  assert.ok(invalid((s) => { delete s.reviewer; }).length);
});

test('validation reports malformed collections, duplicate IDs and credential URLs', () => {
  assert.ok(invalid((s) => { s.aliases = 'python'; }).length);
  assert.ok(invalid((s) => { s.evidence[0].entry_ids = ['missing']; }).length);
  assert.ok(invalid((s) => { s.url = 'https://user:password@www.python.org/'; }).length);
  assert.ok(invalid((s) => { s.entries = [null]; }).length);
  assert.ok(validate(loadCategories(), [valid(), valid()], today).some((e) => e.includes('id 重复')));
});

test('default search excludes pending and expired records; explicit candidate search still supports pinyin', () => {
  assert.equal(top('Python'), 'python');
  assert.equal(top('工行'), undefined);
  for (const [query, id] of [['12306官网', '12306'], ['工行', 'icbc'], ['xuexinwang', 'chsi'], ['zsyh', 'cmbchina'], ['B站', 'bilibili']]) {
    assert.equal(top(query, true), id);
  }
  assert.equal(search('Python', index, { today: '2027-01-01' }).length, 0);
  assert.equal(effectiveStatus('verified', '2026-09-30', today), 'verified');
});

test('Node.js is a product name unless the input explicitly specifies a URL', () => {
  assert.equal(resolveInput('Node.js', index).kind, 'search');
  assert.equal(top('Node.js'), 'nodejs');
  assert.deepEqual(resolveInput('https://node.js', index), { kind: 'host', host: 'node.js' });
  assert.equal(resolveInput('Python下载', index).kind, 'search');
  assert.equal(resolveInput('Node.js下载', index).kind, 'search');
});

test('purpose words select the actual download or documentation entry', () => {
  const python = index.find((s) => s.id === 'python');
  assert.equal(normalizeQuery(' Python 官方下载入口 '), 'python');
  assert.equal(top('Python 下载地址'), 'python');
  assert.equal(preferredEntry(python, 'Python下载', today).url, 'https://www.python.org/downloads/');
  assert.equal(preferredEntry(python, 'Python文档', today).url, 'https://docs.python.org/');
  assert.equal(preferredEntry(index.find((s) => s.id === 'icbc'), '工行', today), null);
});

test('URL parsing preserves exact www host and rejects credentials, private IPs and other protocols', () => {
  assert.equal(extractHost('https://WWW.PYTHON.ORG./downloads/'), 'www.python.org');
  assert.equal(extractHost('docs.python.org'), 'docs.python.org');
  for (const url of ['javascript:alert(1)', 'ftp://www.python.org', 'https://u:p@www.python.org', 'https://www.python.org:8080', 'http://127.0.0.1', 'http://2130706433', 'http://[::1]', 'http://service.local']) assert.equal(parseWebUrl(url), null, url);
});

test('exact host matching never inherits parent-domain trust or asserts phishing', () => {
  assert.equal(checkHost('www.python.org', index, today).status, 'matched');
  for (const host of ['unverified-placeholder.python.org', 'www.python.org.example.org', 'python-tutorial.example.org']) {
    assert.equal(checkHost(host, index, today).status, 'similar');
  }
  assert.equal(checkHost('www.python.org', index, '2027-01-01').status, 'unknown');
  const fixtures = [
    { id: 'chsi', v: 'verified', due: '2026-12-29', h: ['www.chsi.com.cn'] },
    { id: 'yz-chsi', v: 'verified', due: '2026-12-29', h: ['yz.chsi.com.cn'] },
    { id: 'qq', v: 'verified', due: '2026-12-29', h: ['im.qq.com'] },
  ];
  assert.deepEqual(checkHost('yz.chsi.com.cn', fixtures, today).matches.map((s) => s.id), ['yz-chsi']);
  assert.equal(checkHost('mail.qq.com', fixtures, today).status, 'unknown');
});
