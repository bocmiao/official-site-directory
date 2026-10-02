import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { pinyin } from 'pinyin-pro';
import { effectiveStatus, hostOf, parseWebUrl } from '../../src/search.js';
import { classify, TOPICS } from './taxonomy.js';
import { displayName, displayDescription, validateLocalization } from './localization.js';

export { hostOf };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'data');
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const FIELDS = new Set(['id', 'name', 'url', 'aliases', 'description', 'note', 'icp', 'tags', 'owner',
  'verification_status', 'verified_at', 'review_due_at', 'reviewer', 'review_method', 'evidence', 'entries', 'source', 'collected_at', 'region', 'profile', 'subcategory', 'classification', 'localization']);
const ENTRY_FIELDS = new Set(['id', 'label', 'purpose', 'url', 'region', 'language']);
const EVIDENCE_FIELDS = new Set(['url', 'title', 'relation', 'entry_ids']);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const stringList = (v) => Array.isArray(v) && v.every(text);
const readYaml = (file) => yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA }) ?? [];

export function loadCategories(dataDir = DATA_DIR) {
  return readYaml(path.join(dataDir, 'categories.yaml')).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

export function loadSites(dataDir = DATA_DIR, { profiles = true, localization = true } = {}) {
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
  const records = ['catalog.json', 'ror.json', 'directory.json'].flatMap((file) => {
    const imported = path.join(dataDir, 'imported', file);
    const values = fs.existsSync(imported) ? JSON.parse(fs.readFileSync(imported, 'utf8')) : [];
    if (!Array.isArray(values)) throw new Error('Imported catalog must be an array');
    return values.map((s) => ({ ...s, _file: `data/imported/${file}` }));
  });
  const overrideFile = path.join(dataDir, 'overrides.json');
  const overrides = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
  const curatedIds = new Set(curated.map((s) => s.id));
  const importedIds = new Set(records.map((s) => s.id));
  for (const [id, value] of Object.entries(overrides)) {
    if (!importedIds.has(id) && !curatedIds.has(id)) throw new Error(`Override references missing record: ${id}`);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['aliases', 'name', 'description', 'tags', 'verification_status'].includes(key))) throw new Error(`Invalid override: ${id}`);
    if (value.verification_status && !['pending', 'review', 'withdrawn'].includes(value.verification_status)) throw new Error(`Overrides cannot grant verification: ${id}`);
  }
  const sites = [...curated, ...records.filter((s) => !curatedIds.has(s.id)).map((s) => ({ ...s, ...overrides[s.id] }))];
  const snapshotPath = path.join(dataDir, 'imported/directory-evidence.json');
  const snapshots = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : {};
  for (const site of sites.filter((s) => s.source?.id === 'wikidata-directory')) {
    const proof = snapshots[site.id];
    if (!proof || proof.sha256 !== site.source.sha256 || proof.batch !== site.source.batch ||
      createHash('sha256').update(JSON.stringify(proof.row)).digest('hex') !== proof.sha256 ||
      parseWebUrl(proof.row.site?.value)?.href !== site.url ||
      proof.row.item?.value?.split('/').pop() !== site.source.record) throw new Error(`Missing or stale directory snapshot: ${site.id}`);
  }
  const profileFile = path.join(dataDir, 'profiles.json');
  const profileData = profiles && fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile, 'utf8')) : null;
  if (profileData && (profileData.schema_version !== 1 || !profileData.records || typeof profileData.records !== 'object')) throw new Error('Invalid profiles schema');
  const ids = new Set(sites.map((s) => s.id));
  const localizationFile = path.join(dataDir, 'localization/zh-CN.json');
  const translations = localization && fs.existsSync(localizationFile) ? JSON.parse(fs.readFileSync(localizationFile, 'utf8')) : null;
  if (translations && (translations.schema_version !== 1 || !translations.records || typeof translations.records !== 'object' || Array.isArray(translations.records))) throw new Error('Invalid localization schema');
  for (const id of Object.keys(translations?.records || {})) if (!ids.has(id)) throw new Error(`Localization references missing record: ${id}`);
  for (const id of Object.keys(profileData?.records || {})) if (!ids.has(id)) throw new Error(`Profile references missing record: ${id}`);
  return sites.map((s) => {
    const profile = profileData?.records[s.id];
    if (profile && (profile.source_record !== s.source?.record || profile.homepage !== s.url || profile.collected_at !== s.collected_at)) throw new Error(`Stale profile; refresh source metadata: ${s.id}`);
    const translated = translations?.records[s.id];
    if (translated && !validateLocalization(translated, s)) throw new Error(`Invalid or stale localization: ${s.id}`);
    return classify({ ...s, ...(profile ? { profile } : {}), ...(translated ? { localization: translated } : {}) });
  });
}

export function loadSources(dataDir = DATA_DIR) {
  const batches = ['sources.json', 'ror-source.json', 'directory-source.json'].flatMap((file) => {
    const target = path.join(dataDir, 'imported', file);
    return fs.existsSync(target) ? [JSON.parse(fs.readFileSync(target, 'utf8'))] : [];
  });
  return { schema_version: 2, accepted: batches.reduce((n, b) => n + b.accepted, 0),
    sources: batches.flatMap((b) => b.sources.map((s) => ({ ...s, collected_at: b.collected_at,
      ...(s.id === 'ror' && fs.existsSync(path.join(dataDir, 'profiles.json')) ? {
        license: 'CC0-1.0; location metadata CC-BY-4.0',
        attribution: '机构资料来自全球研究机构注册目录（ROR）；国家代码、城市与行政区名称源自 GeoNames（https://www.geonames.org），遵循 CC BY 4.0。未收录经纬度。',
      } : {}) }))), batches };
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
    if (s.subcategory && s.subcategory !== s.category && !TOPICS.some((t) => t.id === s.subcategory && t.category === (s.category.startsWith('institutions-') ? 'institution' : s.category))) fail('未知二级分类');
    if (s.localization && !validateLocalization(s.localization, s)) fail('中文名称与原始记录不一致或字段无效');
    if (s.classification && s.classification !== 'rules-v1') fail('未知分类规则');
    if (s.profile) {
      const p = s.profile;
      const fields = ['source_record', 'homepage', 'collected_at', 'established', 'locations', 'organization_types', 'name_languages', 'source_updated', 'distribution', 'cask_languages', 'package_platforms', 'identifiers', 'package_version'];
      if (Object.keys(p).some((k) => !fields.includes(k))) fail('资料含未知字段');
      if (p.source_record !== s.source?.record || p.homepage !== s.url || p.collected_at !== s.collected_at) fail('资料与来源记录不一致');
      if (p.established != null && (!Number.isInteger(p.established) || p.established < 1 || p.established > Number(today.slice(0, 4)))) fail('成立年份无效');
      if (p.source_updated && (!validDate(p.source_updated) || p.source_updated > today)) fail('上游更新日期无效');
      if (p.package_version != null && !text(p.package_version)) fail('软件包版本必须是非空字符串');
      if (p.identifiers && (!Array.isArray(p.identifiers) || p.identifiers.some((v) => !v || !['wikidata', 'isni', 'fundref', 'grid'].includes(v.scheme) || !text(v.value) || Object.keys(v).some((k) => !['scheme', 'value'].includes(k))))) fail('机构标识资料无效');
      for (const k of ['organization_types', 'name_languages', 'cask_languages', 'package_platforms']) if (p[k] != null && !stringList(p[k])) fail(`资料 ${k} 必须是字符串列表`);
      if (p.locations && (!Array.isArray(p.locations) || p.locations.some((l) => !l || !/^[A-Z]{2}$/.test(l.country) || typeof l.city !== 'string' || typeof l.subdivision !== 'string' || Object.keys(l).some((k) => !['country', 'city', 'subdivision'].includes(k))))) fail('所在地资料无效');
    }
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
      if (!source || !['homebrew-cask', 'hipo-universities', 'ror', 'wikidata-directory'].includes(source.id) || !text(source.record) || !parseWebUrl(source.url)) fail('source 必须包含已支持的 id、record 与来源 url');
      else if (source.id === 'wikidata-directory') {
        if (!/^Q[1-9]\d*$/.test(source.record) || source.url !== `https://www.wikidata.org/wiki/${source.record}` || !/^[a-f0-9]{64}$/.test(source.sha256 || '') || !/^[a-z-]+$/.test(source.batch || '')) fail('维基数据记录缺少实体 ID、查询批次或快照哈希');
      }
      else if (source.id === 'ror') {
        if (!/^https:\/\/ror\.org\/0[a-z0-9]{6}\d{2}$/.test(source.url) || source.record !== source.url || !/^https:\/\/zenodo\.org\/records\/[1-9]\d*$/.test(source.snapshot || '')) fail('ROR 记录必须包含机构 ID 与固定版本快照');
      } else {
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
    const names = [...new Set([displayName(s), s.name, ...s.aliases])];
    const status = effectiveStatus(s.verification_status, s.review_due_at, today);
    return {
      id: s.id, n: displayName(s), o: displayName(s) === s.name ? undefined : s.name, lm: s.localization?.method,
      u: s.url, d: displayDescription(s), c: s.category, a: s.aliases,
      p: [...new Set(names.filter((n) => /[\u3400-\u9fff]/.test(n)).flatMap(pinyinKeys).filter(Boolean))],
      v: status, due: s.review_due_at, checked: s.verified_at,
      r: s.region || '', t: s.tags, source: s.source?.id || 'curated', sc: s.subcategory,
      loc: [...new Set((s.profile?.locations || []).flatMap((l) => [l.city, l.subdivision]).filter(Boolean))].join(' / '),
      e: status === 'verified' ? s.entries : [],
      h: status === 'verified' ? [...new Set(s.entries.map((e) => hostOf(e.url)))] : [],
    };
  });
}
