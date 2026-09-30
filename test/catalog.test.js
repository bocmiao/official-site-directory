import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSites, loadCategories, validate, buildSearchIndex, ROOT } from '../scripts/lib/data.js';
import { importCatalog, identityUrl } from '../scripts/lib/import.js';
import { catalogStats } from '../scripts/lib/stats.js';
import { queryCatalog, checkHost, preferredEntry, hostOf } from '../src/search.js';

const today = '2026-09-30';
const revision = 'a'.repeat(40);
const cask = (token, homepage = `https://${token}.org/`) => ({ token, name: [token], homepage, desc: 'Example application', tap_git_head: revision, ruby_source_path: `Casks/a/${token}.rb` });
const university = (name, url) => ({ name, country: 'China', alpha_two_code: 'CN', web_pages: [url] });
const convert = (casks, universities = [], curated = []) => importCatalog({ casks, universities, curated, universityRevision: revision, retrievedAt: today });
const sites = loadSites();
const index = buildSearchIndex(sites, today);

test('real catalog exceeds 2,000 new records and distinct hosts without promoting provenance to verification', () => {
  const imported = sites.filter((s) => s.source);
  assert.ok(imported.length >= 2000);
  assert.ok(new Set(imported.map((s) => hostOf(s.url))).size >= 2000);
  assert.equal(new Set(imported.map((s) => identityUrl(s.url))).size, imported.length);
  assert.deepEqual(validate(loadCategories(), sites, today), []);
  for (const s of imported) {
    assert.equal(s.verification_status, 'sourced');
    assert.ok(s.url.startsWith('https://'));
    assert.match(s.source.url, /\/blob\/[a-f0-9]{40}\//);
    assert.deepEqual(s.entries, []);
    assert.equal(s.verified_at, undefined);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/imported/sources.json')));
  assert.equal(manifest.accepted, imported.length);
  for (const source of manifest.sources) assert.ok(fs.readFileSync(path.join(ROOT, 'data/licenses', source.license_file), 'utf8').includes('Copyright'));
});

test('import is deterministic, de-duplicates HTTP/www variants, preserves curated rows and rejects unsuitable entries', () => {
  const input = [cask('two', 'https://www.first.org/'), cask('first'), cask('saved'),
    cask('font-family'), { ...cask('retired'), disabled: true }, cask('first@2'),
    cask('private', 'http://127.0.0.1/'), cask('credentials', 'https://u:p@public.org/'),
    cask('tracking', 'https://public.org/?campaign=test'), cask('http-only', 'http://public.org/'), null];
  const curated = [{ name: 'Saved application', url: 'http://www.saved.org/', aliases: [] }];
  const result = convert(input, [], curated);
  assert.deepEqual(result.records.map((s) => s.id), ['brew-first']);
  assert.deepEqual(convert([...input].reverse(), [], curated), result);
  assert.equal(result.skipped.duplicate_url, 2);
  assert.equal(result.skipped.http_only_source, 1);
  assert.equal(result.skipped.invalid_url, 3);
  assert.equal(convert([], [university('School', 'https://school.edu/')]).records[0].region, 'CN');
});

test('provenance schema rejects unsupported sources and misleading verification fields', () => {
  const valid = convert([cask('sample')]).records[0];
  const errors = (change) => { const s = structuredClone(valid); change(s); return validate(loadCategories(), [s], today); };
  assert.ok(errors((s) => { s.source.url = 'https://github.com/Homebrew/homebrew-cask/blob/HEAD/a.rb'; }).length);
  assert.ok(errors((s) => { s.source.id = 'unknown'; }).length);
  assert.ok(errors((s) => { s.verified_at = today; }).length);
  assert.ok(errors((s) => { s.collected_at = '2099-01-01'; }).length);
});

test('editorial overrides survive imports and cannot silently grant verification', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'sites'));
    fs.mkdirSync(path.join(directory, 'imported'));
    const records = convert([cask('sample')]).records;
    const catalogPath = path.join(directory, 'imported/catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify(records));
    const writeOverrides = (value) => fs.writeFileSync(path.join(directory, 'overrides.json'), JSON.stringify(value));
    writeOverrides({ 'brew-sample': { aliases: ['中文名'], verification_status: 'withdrawn' } });
    assert.equal(loadSites(directory)[0].verification_status, 'withdrawn');
    fs.writeFileSync(catalogPath, JSON.stringify(convert([cask('sample')]).records));
    assert.deepEqual(loadSites(directory)[0].aliases, ['中文名']);
    writeOverrides({ 'brew-sample': { verification_status: 'verified' } });
    assert.throws(() => loadSites(directory), /cannot grant/);
    writeOverrides({ missing: { aliases: ['不存在'] } });
    assert.throws(() => loadSites(directory), /missing record/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('catalog pagination and combined filters operate on all matches, not the first 20', () => {
  const first = queryCatalog('', index, { today });
  const second = queryCatalog('', index, { page: 2, today });
  assert.equal(first.items.length, 24);
  assert.equal(second.items.length, 24);
  assert.equal(new Set([...first.items, ...second.items].map((s) => s.id)).size, 48);
  const filtered = queryCatalog('', index, { category: 'education', region: 'CN', status: 'sourced', today });
  assert.ok(filtered.total >= 10);
  assert.ok(filtered.items.every((s) => s.c === 'education' && s.r === 'CN' && s.v === 'sourced'));
  const last = queryCatalog('university', index, { page: 99999, today });
  assert.ok(last.total > 20);
  assert.equal(last.page, last.pages);
  assert.equal(queryCatalog('no-result-zzzz', index).total, 0);
  assert.equal(queryCatalog('', index, { pageSize: 0 }).pageSize, 1);
});

test('Chinese aliases and pinyin locate imported records while source records never become trusted hosts or direct links', () => {
  for (const q of ['火狐', 'huohu', 'Firefox']) assert.equal(queryCatalog(q, index, { today }).items[0].id, 'brew-firefox');
  assert.equal(queryCatalog('上海交通大学', index, { today }).items[0].id, 'uni-5c73e774694dd1b4');
  const firefox = index.find((s) => s.id === 'brew-firefox');
  assert.equal(preferredEntry(firefox, '火狐下载', today), null);
  assert.notEqual(checkHost(hostOf(firefox.u), index, today).status, 'matched');
  assert.equal(queryCatalog('火狐', index, { status: 'verified', today }).total, 0);
  assert.equal(queryCatalog('工行', index, { today }).total, 0);
  assert.equal(queryCatalog('工行', index, { status: 'pending', today }).items[0].id, 'icbc');
});

test('quality totals reconcile statuses, sources and records', () => {
  const stats = catalogStats(sites, today);
  for (const key of ['status', 'categories', 'sources', 'regions']) assert.equal(Object.values(stats[key]).reduce((a, b) => a + b, 0), stats.total);
  assert.equal(stats.https + stats.http, stats.total);
  assert.equal(stats.verified_entries, 14);
});
