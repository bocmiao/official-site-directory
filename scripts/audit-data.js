import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOT, loadSites, loadCategories, validate, buildSearchIndex } from './lib/data.js';
import { catalogStats } from './lib/stats.js';
import { queryCatalog } from '../src/search.js';
import { identityUrl } from './lib/import.js';

const sites = loadSites();
const errors = validate(loadCategories(), sites);
const imported = sites.filter((s) => s.source);
if (imported.length < 2000) errors.push('Imported catalog below 2,000 records');
if (new Set(imported.map((s) => identityUrl(s.url))).size !== imported.length) errors.push('Duplicate imported homepage');
if (errors.length) throw new Error(errors.join('\n'));
const stats = catalogStats(sites);
const index = buildSearchIndex(sites);
const queries = ['Python 下载', '火狐', 'huohu', '上海交大', 'university', 'editor', 'not-found-zzzz'];
const timings = [];
for (let round = 0; round < 5; round++) for (const query of queries) {
  const start = performance.now();
  queryCatalog(query, index);
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const report = { ...stats, search_index_bytes: Buffer.byteLength(JSON.stringify(index)),
  search_benchmark: { node: process.version, samples: timings.length,
    median_ms: +timings[Math.floor(timings.length / 2)].toFixed(2), p95_ms: +timings[Math.floor(timings.length * 0.95)].toFixed(2) } };
// Report is a local build artifact, never an assertion that websites are verified.
const output = path.join(ROOT, '.reports');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'quality.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, status: report.status, sources: report.sources,
  unique_hosts: report.unique_hosts, search_index_bytes: report.search_index_bytes, search_benchmark: report.search_benchmark }, null, 2));
