import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { pinyin } from 'pinyin-pro';
import { effectiveStatus, hostOf, parseWebUrl } from '../../src/search.js';

export { hostOf };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'data');
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const FIELDS = new Set(['id', 'name', 'url', 'aliases', 'description', 'note', 'icp', 'tags', 'owner',
  'verification_status', 'verified_at', 'review_due_at', 'reviewer', 'review_method', 'evidence', 'entries', 'source', 'collected_at', 'region']);
const ENTRY_FIELDS = new Set(['id', 'label', 'purpose', 'url', 'region', 'language']);
const EVIDENCE_FIELDS = new Set(['url', 'title', 'relation', 'entry_ids']);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const stringList = (v) => Array.isArray(v) && v.every(text);
const readYaml = (file) => yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA }) ?? [];

export function loadCategories(dataDir = DATA_DIR) {
  return readYaml(path.join(dataDir, 'categories.yaml')).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

export function loadSites(dataDir = DATA_DIR) {
  const dir = path.join(dataDir, 'sites');
  const curated = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().flatMap((file) => {
    const entries = readYaml(path.join(dir, file));
    if (!Array.isArray(entries)) throw new Error(`${file}: 顶层必须是列表`);
    return entries.map((s) => ({
      ...s, id: s.id == null ? s.id : String(s.id),
      aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : (s.aliases ?? []),
      tags: s.tags ?? [], entries: s.entries ?? [], evidence: s.evidence ?? [],
      category: path.basename(file, '.yaml'), _file: `data/sites/${file}`,
    }));
  });
  const imported = path.join(dataDir, 'imported', 'catalog.json');
  const records = fs.existsSync(imported) ? JSON.parse(fs.readFileSync(imported, 'utf8')) : [];
  if (!Array.isArray(records)) throw new Error('Imported catalog must be an array');
  const overrideFile = path.join(dataDir, 'overrides.json');
  const overrides = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
  const curatedIds = new Set(curated.map((s) => s.id));
  const importedIds = new Set(records.map((s) => s.id));
  for (const [id, value] of Object.entries(overrides)) {
    if (!importedIds.has(id) && !curatedIds.has(id)) throw new Error(`Override references missing record: ${id}`);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['aliases', 'name', 'description', 'tags', 'verification_status'].includes(key))) throw new Error(`Invalid override: ${id}`);
    if (value.verification_status && !['pending', 'review', 'withdrawn'].includes(value.verification_status)) throw new Error(`Overrides cannot grant verification: ${id}`);
  }
  return [...curated, ...records.filter((s) => !curatedIds.has(s.id)).map((s) => ({ ...s, ...overrides[s.id], _file: 'data/imported/catalog.json' }))];
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validate(categories, sites, today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  const catIds = new Set();
  for (const c of categories) {
    if (!text(c.id) || !ID_RE.test(c.id) || !text(c.name) || catIds.has(c.id)) errors.push('分类 id/name 无效或重复');
    catIds.add(c.id);
  }
  const ids = new Set();
  const urls = new Set();
  for (const s of sites) {
    const where = `${s._file} [${s.id ?? '?'}]`;
    const fail = (message) => errors.push(`${where}: ${message}`);
    for (const key of Object.keys(s)) {
      if (!key.startsWith('_') && key !== 'category' && !FIELDS.has(key)) fail(`未知字段 ${key}`);
    }
    if (!text(s.id) || !ID_RE.test(s.id)) fail('id 必填，只能包含小写字母、数字和连字符');
    if (ids.has(s.id)) fail('id 重复');
    ids.add(s.id);
    for (const key of ['name', 'description']) if (!text(s[key])) fail(`${key} 必填`);
    for (const key of ['aliases', 'tags']) if (!stringList(s[key])) fail(`${key} 必须是非空字符串列表`);
    if (!catIds.has(s.category)) fail('未知分类');
    const url = parseWebUrl(s.url);
    if (!url) fail('url 必须是无凭据、无自定义端口的公开 http(s) URL');
    if (url?.search || url?.hash) fail('首页 url 不应包含查询参数或锚点');
    if (url) {
      const key = url.href.replace(/\/$/, '');
      if (urls.has(key)) fail('url 重复');
      urls.add(key);
    }
    if (!['pending', 'sourced', 'verified', 'review', 'withdrawn'].includes(s.verification_status)) fail('verification_status 无效或缺失');
    if (s.region != null && (typeof s.region !== 'string' || !/^(GLOBAL|[A-Z]{2})$/.test(s.region))) fail('region 必须是地区代码或 GLOBAL');
    if (s.verification_status === 'sourced' || s.source != null) {
      const source = s.source;
      if (!source || !['homebrew-cask', 'hipo-universities'].includes(source.id) || !text(source.record) || !parseWebUrl(source.url)) fail('source 必须包含已支持的 id、record 与来源 url');
      else {
        const prefix = source.id === 'homebrew-cask' ? 'https://github.com/Homebrew/homebrew-cask/blob/' : 'https://github.com/Hipo/university-domains-list/blob/';
        if (!source.url.startsWith(prefix) || !/^[a-f0-9]{40}\//.test(source.url.slice(prefix.length))) fail('source.url 必须固定到来源仓库的提交');
      }
      if (!validDate(s.collected_at) || s.collected_at > today) fail('collected_at 必须是有效的非未来日期');
      if (s.verification_status === 'sourced' && (s.verified_at || s.reviewer || s.review_method || s.review_due_at || s.entries?.length || s.evidence?.length)) fail('来源收录不能携带核验结论');
    }
    if (!Array.isArray(s.entries) || !Array.isArray(s.evidence)) {
      fail('entries/evidence 必须是列表');
      continue;
    }
    const entryIds = new Set();
    const entryUrls = new Set();
    for (const e of s.entries) {
      if (!e || typeof e !== 'object') { fail('入口必须是对象'); continue; }
      for (const key of Object.keys(e)) if (!ENTRY_FIELDS.has(key)) fail(`入口未知字段 ${key}`);
      if (!text(e.id) || !ID_RE.test(e.id) || entryIds.has(e.id)) fail('入口 id 无效或重复');
      entryIds.add(e.id);
      for (const key of ['label', 'region', 'language']) if (!text(e[key])) fail(`入口 ${key} 必填`);
      if (!['home', 'download', 'docs', 'login', 'source'].includes(e.purpose)) fail('入口 purpose 无效');
      const target = parseWebUrl(e.url);
      if (!target) fail('入口 url 无效');
      if (target && entryUrls.has(target.href)) fail('入口 url 重复');
      if (target) entryUrls.add(target.href);
    }
    const covered = new Set();
    for (const e of s.evidence) {
      if (!e || typeof e !== 'object') { fail('证据必须是对象'); continue; }
      for (const key of Object.keys(e)) if (!EVIDENCE_FIELDS.has(key)) fail(`证据未知字段 ${key}`);
      if (!parseWebUrl(e.url) || !text(e.title) || !text(e.relation)) fail('证据 url/title/relation 必填且有效');
      if (!stringList(e.entry_ids) || !e.entry_ids.length) fail('证据必须关联 entry_ids');
      else for (const id of e.entry_ids) {
        if (!entryIds.has(id)) fail(`证据引用不存在的入口 ${id}`);
        covered.add(id);
      }
    }
    if (s.verification_status === 'verified') {
      for (const key of ['owner', 'reviewer']) if (!text(s[key])) fail(`已核验记录缺少 ${key}`);
      if (!['human', 'assisted'].includes(s.review_method)) fail('review_method 必须是 human 或 assisted');
      if (!validDate(s.verified_at) || s.verified_at > today) fail('verified_at 必须是有效的非未来日期');
      if (!validDate(s.review_due_at) || s.review_due_at < s.verified_at) fail('review_due_at 无效');
      if (!s.entries.some((e) => e?.purpose === 'home' && parseWebUrl(e.url)?.href === url?.href)) fail('缺少与首页 url 一致的 home 入口');
      for (const id of entryIds) if (!covered.has(id)) fail(`入口 ${id} 缺少核验证据`);
      if (!s.evidence.length) fail('已核验记录缺少 evidence');
    }
  }
  return errors;
}

function pinyinKeys(text) {
  const options = { toneType: 'none', type: 'array' };
  return [pinyin(text, options), pinyin(text, { ...options, pattern: 'first' })]
    .map((parts) => parts.join('').toLowerCase().replace(/[^a-z0-9]/g, ''));
}

export function buildSearchIndex(sites, today) {
  return sites.filter((s) => s.verification_status !== 'withdrawn').map((s) => {
    const names = [s.name, ...s.aliases];
    const status = effectiveStatus(s.verification_status, s.review_due_at, today);
    return {
      id: s.id, n: s.name, u: s.url, d: s.description, c: s.category, a: s.aliases,
      p: [...new Set(names.filter((n) => /[\u3400-\u9fff]/.test(n)).flatMap(pinyinKeys).filter(Boolean))],
      v: status, due: s.review_due_at, checked: s.verified_at,
      r: s.region || '', t: s.tags, source: s.source?.id,
      e: status === 'verified' ? s.entries : [],
      h: status === 'verified' ? [...new Set(s.entries.map((e) => hostOf(e.url)))] : [],
    };
  });
}
