import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/lib/data.js';

const build = (siteUrl, production = false) => spawnSync(process.execPath, ['scripts/build.js', ...(production ? ['--production'] : [])], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, SITE_URL: siteUrl },
});
const read = (file) => fs.readFileSync(path.join(ROOT, 'dist', file), 'utf8');

test('publication requires an explicit HTTPS site URL; candidates stay out of sitemap and direct links', () => {
  assert.notEqual(build('', true).status, 0);
  assert.notEqual(build('https://example.com', true).status, 0);
  assert.notEqual(build('http://bocmiao.github.io/official-site-directory', true).status, 0);
  const result = build('https://bocmiao.github.io/official-site-directory', true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read('index.html'), /https:\/\/bocmiao.github.io\/official-site-directory\//);
  const version = read('index.html').match(/data-build="([a-f0-9]+)"/)[1];
  assert.ok(read('index.html').includes(`style.css?v=${version}`));
  assert.ok(read('assets/app.js').includes(`search.js?v=${version}`));
  const candidate = read('site/icbc.html');
  assert.match(candidate, /noindex,follow/);
  assert.doesNotMatch(candidate, /href="https:\/\/www.icbc.com.cn/);
  assert.doesNotMatch(read('sitemap.xml'), /site\/icbc.html/);
  const detail = read('site/python.html');
  assert.match(detail, /AI 辅助来源核对/);
  assert.match(detail, /github.com\/python\/cpython/);
  assert.match(detail, /关联入口/);
  assert.equal(build('').status, 0);
  assert.doesNotMatch(read('index.html'), /rel="canonical"/);
  assert.equal(fs.existsSync(path.join(ROOT, 'dist', 'sitemap.xml')), false);
});
