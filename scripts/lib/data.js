import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { pinyin } from 'pinyin-pro';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'data');

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED_FIELDS = new Set(['id', 'name', 'url', 'aliases', 'description', 'note', 'domains', 'icp', 'tags']);

function readYaml(file) {
  return yaml.load(fs.readFileSync(file, 'utf8')) ?? [];
}

// YAML 会把 12306 这类纯数字解析成 number，这里统一转成字符串
const str = (v) => (v === undefined || v === null ? v : String(v));
const strList = (v) => (Array.isArray(v) ? v.map(String) : v);

export function loadCategories(dataDir = DATA_DIR) {
  return readYaml(path.join(dataDir, 'categories.yaml'))
    .map((c) => ({ ...c, id: str(c.id) }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

export function loadSites(dataDir = DATA_DIR) {
  const dir = path.join(dataDir, 'sites');
  const sites = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
    const category = path.basename(file, '.yaml');
    const entries = readYaml(path.join(dir, file));
    if (!Array.isArray(entries)) throw new Error(`${file}: 顶层必须是列表`);
    for (const e of entries) {
      sites.push({
        ...e,
        id: str(e.id),
        name: str(e.name),
        aliases: strList(e.aliases) ?? [],
        domains: strList(e.domains) ?? [],
        tags: strList(e.tags) ?? [],
        category,
        _file: `data/sites/${file}`,
      });
    }
  }
  return sites;
}

/** 返回去掉 www. 前缀的小写主机名 */
export function hostOf(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** 校验全部数据，返回错误信息数组（为空表示通过） */
export function validate(categories, sites) {
  const errors = [];
  const catIds = new Set(categories.map((c) => c.id));
  const seenIds = new Map();
  const seenUrls = new Map();

  for (const s of sites) {
    const where = `${s._file} [${s.id ?? s.name ?? '?'}]`;
    for (const key of Object.keys(s)) {
      if (!key.startsWith('_') && key !== 'category' && !ALLOWED_FIELDS.has(key)) {
        errors.push(`${where}: 未知字段 "${key}"`);
      }
    }
    if (!s.id || !ID_RE.test(s.id)) errors.push(`${where}: id 必填，且只能包含小写字母、数字和连字符`);
    if (!s.name) errors.push(`${where}: name 必填`);
    if (!s.description) errors.push(`${where}: description 必填`);
    if (!catIds.has(s.category)) errors.push(`${where}: 分类 "${s.category}" 未在 data/categories.yaml 中定义`);

    let parsed;
    try {
      parsed = new URL(s.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) errors.push(`${where}: url 必须是 http(s)`);
      if (parsed.search || parsed.hash) errors.push(`${where}: url 不应包含查询参数或锚点（避免推广链接）`);
    } catch {
      errors.push(`${where}: url 无效 "${s.url}"`);
    }

    for (const d of s.domains) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) errors.push(`${where}: domains 中的 "${d}" 不是合法域名`);
    }

    if (s.id) {
      if (seenIds.has(s.id)) errors.push(`${where}: id 与 ${seenIds.get(s.id)} 重复`);
      else seenIds.set(s.id, where);
    }
    if (parsed) {
      const key = parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
      if (seenUrls.has(key)) errors.push(`${where}: url 与 ${seenUrls.get(key)} 重复`);
      else seenUrls.set(key, where);
    }
  }
  return errors;
}

function pinyinKeys(text) {
  const full = pinyin(text, { toneType: 'none', type: 'array' }).join('');
  const initials = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('');
  const clean = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [clean(full), clean(initials)];
}

/** 生成前端搜索用的精简索引 */
export function buildSearchIndex(sites) {
  return sites.map((s) => {
    const names = [s.name, ...s.aliases];
    const py = new Set();
    for (const n of names) {
      if (/[一-龥]/.test(n)) for (const k of pinyinKeys(n)) if (k) py.add(k);
    }
    return {
      id: s.id,
      n: s.name,
      u: s.url,
      d: s.description,
      c: s.category,
      a: s.aliases,
      h: [hostOf(s.url), ...s.domains],
      p: [...py],
      ...(s.note ? { w: s.note } : {}),
    };
  });
}
