import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSites, loadCategories, validate, hostOf } from './lib/data.js';
import { probeEntry, recordResult, reportSignature } from './lib/probe.js';
import { effectiveStatus } from '../src/search.js';

const directory = path.join(ROOT, '.monitor');
fs.mkdirSync(directory, { recursive: true });
const statePath = path.join(directory, 'state.json');
let previous = {};
if (fs.existsSync(statePath)) previous = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const sites = loadSites();
const errors = validate(loadCategories(), sites);
if (errors.length) throw new Error(errors.join('\n'));
const checked_at = new Date().toISOString();
const today = checked_at.slice(0, 10);
const probe_region = process.env.PROBE_REGION || 'local-unspecified';
const tasks = sites.filter((s) => s.verification_status === 'verified').flatMap((site) => site.entries.map((entry) => ({ site, entry })));
let next = 0;
const results = [];
await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
  while (next < tasks.length) {
    const { site, entry } = tasks[next++];
    const key = `${site.id}/${entry.id}`;
    const result = await probeEntry(entry, site.entries.map((e) => hostOf(e.url)));
    results.push(recordResult(result, previous.records?.[key], { key, name: `${site.name} · ${entry.label}`, url: entry.url, checked_at, probe_region }));
  }
}));
for (const site of sites) {
  const status = effectiveStatus(site.verification_status, site.review_due_at, today);
  if (status === 'review') results.push({ key: `${site.id}/verification`, name: site.name, url: site.url,
    checked_at, probe_region, level: 'review', reason: 'VERIFICATION_REVIEW_DUE', failures: 0, actionable: true });
}
results.sort((a, b) => a.key.localeCompare(b.key));
const actionable = results.filter((r) => r.actionable);
const signature = reportSignature(results);
const changed = signature !== (previous.signature || '[]');
const clean = (s) => String(s ?? '').replace(/[\r\n|<>@]/g, ' ');
const markdown = [
  '# 官网入口巡检', '', `检测时间：${checked_at} · 节点：${probe_region}`, '',
  `共检测 ${tasks.length} 个入口，${actionable.length} 项需要复核。单次网络失败只记录，连续两次失败才进入复核。`, '',
  '| 产品与入口 | 结果 | 连续异常 | 需要复核 |', '| --- | --- | --- | --- |',
  ...results.map((r) => `| ${clean(r.name)} | ${clean(r.reason)} | ${r.failures} | ${r.actionable ? '是' : '否'} |`), '',
  '完整 URL、重定向链及节点信息见本次运行的 monitor-report artifact。连接结果不改变身份核验日期，也不自动删除记录。',
].join('\n');
fs.writeFileSync(path.join(directory, 'report.md'), markdown);
fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ checked_at, probe_region, changed, signature, actionable: actionable.length, results }, null, 2));
fs.writeFileSync(statePath, JSON.stringify({ checked_at, signature, records: Object.fromEntries(results.map((r) => [r.key, r])) }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
if (process.argv.includes('--strict') && actionable.length) process.exitCode = 1;
