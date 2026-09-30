// Shared by browser, build, monitoring and tests. No implicit subdomain trust.
const SUFFIX_RE = /(官方网站|官方网址|官网|官方|网址|网站|首页|入口|地址|登录|登陆|下载|文档|教程|源码|app)+$/i;
const compact = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
// Index objects are immutable after loading. Cache normalized text rather than
// parsing 20,000+ homepages and allocating alias arrays on every keystroke.
const documents = new WeakMap();
function searchDocument(site) {
  if (!documents.has(site)) documents.set(site, {
    names: [site.n, ...site.a].map(compact),
    hosts: [...site.h, hostOf(site.u) || ''],
    tags: (site.t || []).map(compact), description: site.d.toLowerCase(),
  });
  return documents.get(site);
}
export const STATUS_LABELS = { verified: '已核对来源', sourced: '来源收录 · 未核验', pending: '待审核', review: '待复核', withdrawn: '已撤销' };

export function effectiveStatus(status, due, today = new Date().toISOString().slice(0, 10)) {
  return status === 'verified' && (!due || due < today) ? 'review' : status;
}
export const isVerified = (site, today) => effectiveStatus(site.v, site.due, today) === 'verified';

export function parseWebUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    const host = url.hostname.replace(/\.$/, '');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(host)) return null;
    if (/\.(localhost|local|internal|test|invalid)$/i.test(host)) return null;
    url.hostname = host;
    return url;
  } catch { return null; }
}

export const hostOf = (value) => parseWebUrl(value)?.hostname ?? null;

export function extractHost(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  return hostOf(explicit ? raw : `https://${raw}`);
}

export function normalizeQuery(q) {
  const text = compact(q);
  return text.replace(SUFFIX_RE, '') || text;
}

export function queryPurpose(query) {
  const text = compact(query);
  if (/下载(?:入口|地址)?$/.test(text)) return 'download';
  if (/(文档|教程)$/.test(text)) return 'docs';
  if (/(登录|登陆)(?:入口)?$/.test(text)) return 'login';
  if (/源码$/.test(text)) return 'source';
  return 'home';
}

export function resolveInput(input, index) {
  const raw = String(input ?? '').trim();
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.includes('@');
  const normalized = compact(raw);
  const query = normalizeQuery(raw);
  if (!explicit && index.some((s) => searchDocument(s).names.some((n) => n === normalized || n === query))) return { kind: 'search' };
  const host = extractHost(raw);
  if (host) return { kind: 'host', host };
  return { kind: explicit ? 'invalid' : 'search' };
}

export function checkHost(host, index, today) {
  const normalized = extractHost(host);
  if (!normalized) return { status: 'unknown', host, matches: [] };
  const verified = index.filter((s) => isVerified(s, today));
  const matches = verified.filter((s) => s.h.includes(normalized));
  if (matches.length) return { status: 'matched', host: normalized, matches };
  // Similarity is a navigation hint only, never a phishing verdict.
  const similar = verified.filter((s) => s.h.some((h) => {
    const brand = h.replace(/^www\./, '').split('.')[0];
    return brand.length >= 4 && normalized.includes(brand);
  }));
  return { status: similar.length ? 'similar' : 'unknown', host: normalized, matches: similar };
}

function scoreText(q, text) {
  return text === q ? 100 : text.startsWith(q) ? 80 : text.includes(q) ? 60 : 0;
}

export function search(query, index, { includePending = false, includeSourced = false, limit = 20, today = new Date().toISOString().slice(0, 10) } = {}) {
  const raw = compact(query);
  const q = normalizeQuery(query);
  if (!q) return [];
  const results = [];
  for (const site of index) {
    if (site.v === 'withdrawn' || (!includePending && !isVerified(site, today) && !(includeSourced && site.v === 'sourced'))) continue;
    const document = searchDocument(site);
    let score = 0;
    for (const name of document.names) score = Math.max(score, scoreText(q, name), name === raw ? 110 : 0);
    if (/^[a-z0-9]+$/.test(q)) for (const p of site.p) {
      if (p === q) score = Math.max(score, 70);
      else if (q.length >= 2 && p.startsWith(q)) score = Math.max(score, 50);
    }
    if (q.length >= 2 && document.hosts.some((h) => h.includes(q))) score = Math.max(score, 40);
    if (q.length >= 2 && document.tags.some((t) => t.includes(q))) score = Math.max(score, 25);
    if (q.length >= 2 && document.description.includes(q)) score = Math.max(score, 15);
    if (score) results.push({ site, score });
  }
  results.sort((a, b) => Number(isVerified(b.site, today)) - Number(isVerified(a.site, today)) ||
    b.score - a.score || a.site.id.localeCompare(b.site.id));
  return results.slice(0, limit).map(({ site }) => site);
}

// Paged browsing is separate from the conservative verified-only search API.
export function queryCatalog(query, index, { category = '', region = '', status = 'catalog', page = 1, pageSize = 24, today = new Date().toISOString().slice(0, 10) } = {}) {
  const filtered = index.filter((s) => {
    const current = effectiveStatus(s.v, s.due, today);
    if (current === 'withdrawn' || (category && s.c !== category) || (region && s.r !== region)) return false;
    return status === 'all' || (status === 'catalog' ? ['verified', 'sourced'].includes(current) : current === status);
  });
  const matched = query.trim() ? search(query, filtered, { includePending: true, limit: Infinity, today }) : filtered;
  const size = Math.max(1, Math.min(100, Number.isFinite(pageSize) ? Math.floor(pageSize) : 24));
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const currentPage = Math.max(1, Math.min(pages, Number.isFinite(page) ? Math.floor(page) : 1));
  return { items: matched.slice((currentPage - 1) * size, currentPage * size), total: matched.length, page: currentPage, pages, pageSize: size };
}

export function preferredEntry(site, query, today) {
  if (!isVerified(site, today)) return null;
  const purpose = queryPurpose(query);
  return site.e.find((e) => e.purpose === purpose) ?? site.e.find((e) => e.purpose === 'home');
}
