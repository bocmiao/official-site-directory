import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadSites, loadCategories, validate, buildSearchIndex } from '../scripts/lib/data.js';
import { digest, identityUrl } from '../scripts/lib/import.js';
import { importDirectory } from '../scripts/import-directory.js';
import { checkHost } from '../src/search.js';

const sites = loadSites();
const batch = sites.filter((s) => s.source?.id === 'wikidata-directory');
test('all fifteen categories meet 1,000, with the entire previous baseline retained', () => {
  assert.equal(loadCategories().length, 15);
  for (const category of loadCategories()) assert.ok(sites.filter((s) => s.category === category.id && s.verification_status !== 'withdrawn').length >= 1000, category.id);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/imported/directory-source.json')));
  const previous = sites.filter((s) => s.source?.id !== 'wikidata-directory');
  assert.equal(previous.length, manifest.baseline_count);
  assert.equal(digest(previous.map((s) => s.id).sort().join('\n')), manifest.baseline_ids_sha256);
  assert.equal(batch.length, 11831);
  assert.equal(new Set(sites.map((s) => s.id)).size, sites.length);
  assert.equal(new Set(batch.map((s) => identityUrl(s.url))).size, batch.length);
  assert.ok(batch.every((s) => s.localization && s.profile && s.tags.length));
});

test('batch keeps original URL protocol and cannot confer verified status', () => {
  const s = batch.find((s) => s.url.startsWith('http:'));
  assert.ok(s);
  assert.equal(s.verification_status, 'sourced');
  const index = buildSearchIndex(batch, '2026-10-02');
  assert.ok(index.every((r) => r.e.length === 0 && r.h.length === 0));
  assert.equal(checkHost(new URL(s.url).hostname, index).status, 'unknown');
  const invalid = structuredClone(s); delete invalid.source.sha256;
  assert.ok(validate(loadCategories(), [invalid]).length);
});

test('snapshot edits or mismatched URLs stop loading before publication', () => {
  const s = batch[0];
  const proofs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/imported/directory-evidence.json')));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-snapshot-'));
  try {
    fs.mkdirSync(path.join(temp, 'sites'));
    fs.mkdirSync(path.join(temp, 'imported'));
    fs.writeFileSync(path.join(temp, 'imported/directory.json'), JSON.stringify([s]));
    fs.writeFileSync(path.join(temp, 'imported/directory-evidence.json'), JSON.stringify({ [s.id]: proofs[s.id] }));
    assert.equal(loadSites(temp).length, 1);
    proofs[s.id].row.site.value = 'https://wrong.example.org/';
    fs.writeFileSync(path.join(temp, 'imported/directory-evidence.json'), JSON.stringify({ [s.id]: proofs[s.id] }));
    assert.throws(() => loadSites(temp), /stale directory snapshot/);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('directory-snapshot-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('import removes cross-category tools, museums, duplicate homepages and unsafe addresses', () => {
  const row = (id, name, url) => ({ item: { value: `http://www.wikidata.org/entity/${id}` }, en: { value: name }, site: { value: url } });
  const shared = row('Q123', 'Social service', 'https://fixture-social.org/');
  const inputs = { tools: [shared, row('Q124', 'Safe tool', 'https://fixture-tool.org/')], social: [shared],
    education: [row('Q125', 'City Museum', 'https://fixture-museum.org/')],
    games: [row('Q126', 'Game', 'https://fixture-game.org/'), row('Q127', 'Same homepage', 'http://www.fixture-game.org/'), row('Q128', 'Private', 'http://127.0.0.1/')] };
  const output = importDirectory(inputs, [], '2026-09-30');
  assert.deepEqual(output.records.map((s) => s.id), ['wd-q124', 'wd-q123', 'wd-q126']);
  assert.equal(output.skipped.more_specific_category, 1);
  assert.equal(output.skipped.museum_not_learning_portal, 1);
  assert.equal(output.skipped.duplicate_identity, 1);
  assert.equal(output.skipped.unsuitable_record, 1);
});
