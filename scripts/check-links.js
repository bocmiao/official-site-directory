// 巡检所有官网：是否可访问、是否跳转到了未登记的域名（可能是官网换域名或被劫持）。
// 用法：node scripts/check-links.js [--strict]
// 注意：部分国内网站会拦截境外 IP，在 GitHub Actions 上可能出现误报，建议在境内机器上运行。
import fs from 'node:fs';
import { loadSites, hostOf } from './lib/data.js';

const strict = process.argv.includes('--strict');
const TIMEOUT = 15000;
const CONCURRENCY = 8;
const UA = 'Mozilla/5.0 (compatible; OfficialSiteDirectoryBot/0.1; +https://github.com/bocmiao/official-site-directory)';

async function check(site) {
  const official = [hostOf(site.url), ...site.domains];
  try {
    const res = await fetch(site.url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT), headers: { 'user-agent': UA } });
    const finalHost = hostOf(res.url);
    const onOfficial = official.some((h) => finalHost === h || finalHost.endsWith('.' + h));
    if (!onOfficial) return { site, level: 'warn', msg: `跳转到了未登记的域名 ${finalHost}` };
    if (res.status >= 400) return { site, level: 'warn', msg: `HTTP ${res.status}` };
    return { site, level: 'ok', msg: `HTTP ${res.status}` };
  } catch (e) {
    return { site, level: 'error', msg: e.cause?.code || e.name || String(e) };
  }
}

const sites = loadSites();
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < sites.length) results.push(await check(sites[next++]));
  }),
);

const bad = results.filter((r) => r.level !== 'ok');
const lines = [
  `## 官网巡检：${results.length - bad.length}/${results.length} 正常`,
  '',
  ...(bad.length
    ? ['| 站点 | 网址 | 问题 |', '| --- | --- | --- |', ...bad.map((r) => `| ${r.site.name} | ${r.site.url} | ${r.level === 'error' ? '❌' : '⚠️'} ${r.msg} |`)]
    : ['全部正常 ✅']),
];
const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
if (strict && bad.length) process.exit(1);
