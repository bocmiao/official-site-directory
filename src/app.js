import { queryCatalog, resolveInput, checkHost, preferredEntry, isVerified, effectiveStatus, STATUS_LABELS, hostOf, parseWebUrl } from './search.js';

const $ = (selector) => document.querySelector(selector);
const input = $('#q');
const category = $('#category-filter');
const region = $('#region-filter');
const status = $('#status-filter');
const clear = $('#clear-filters');
const results = $('#results');
const verdict = $('#verdict');
const browse = $('#browse');
const info = $('#result-info');
const loadStatus = $('#load-status');
const retry = $('#retry');
const pagination = $('#pagination');
const previous = $('#previous-page');
const next = $('#next-page');
const pageInfo = $('#page-info');
const controls = [input, category, region, status, clear];
const base = document.documentElement.dataset.base || './';
let index = [];
let loaded = false;
let page = 1;
let pages = 1;
let timer;
let composing = false;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function card(site, query) {
  const preferred = preferredEntry(site, query);
  const entry = preferred && parseWebUrl(preferred.url) ? preferred : null;
  const detail = `${base}site/${site.id}.html`;
  const current = effectiveStatus(site.v, site.due);
  return el('li', { class: 'card' },
    el('a', { class: 'card-main', href: entry?.url ?? detail, ...(entry ? { target: '_blank', rel: 'noopener noreferrer' } : {}) },
      el('span', { class: 'card-name' }, site.n),
      el('span', { class: `card-host ${entry ? '' : 'host-unverified'}` }, hostOf(entry?.url ?? site.u) || '地址待核对'),
      el('span', { class: 'card-desc' }, site.d),
      ...(entry ? [el('span', { class: 'entry-purpose' }, `${entry.label} · ${entry.region}`)] : [])),
    el('p', { class: 'card-status' }, `${STATUS_LABELS[current]}${entry ? ` · ${site.checked}` : ' · 仅查看资料'}`),
    el('a', { class: 'card-detail', href: detail }, '查看入口与依据'));
}

function renderVerdict(host) {
  const result = checkHost(host, index);
  const sourceMatches = index.filter((s) => s.v === 'sourced' && hostOf(s.u) === host);
  verdict.hidden = false;
  verdict.className = `verdict verdict-${result.status}`;
  if (result.status === 'matched') {
    verdict.textContent = `${host} 与已核对入口的主机名一致。仅比对主机名，不验证当前路径、网页内容或下载文件。请使用下方已登记入口。`;
  } else if (sourceMatches.length) {
    verdict.textContent = `${host} 有第三方来源收录，但尚未核验官方身份。下方资料仅供进一步核对，不能据此确认官网。`;
  } else if (result.status === 'similar') {
    verdict.textContent = `${host} 未匹配已核对入口，与下方部分入口的名称相似。相似不代表仿冒，未收录也不代表不安全，请进一步核对来源。`;
  } else {
    verdict.textContent = `${host} 暂无已核对的匹配记录。未收录不代表是假网站，可提交来源供审核。`;
  }
  return [...new Map([...result.matches, ...sourceMatches].map((s) => [s.id, s])).values()];
}

function run() {
  if (!loaded) return;
  const query = input.value.trim();
  verdict.hidden = true;
  let candidates = index;
  let textQuery = query;
  if (query) {
    const route = resolveInput(query, index);
    if (route.kind === 'host') {
      candidates = renderVerdict(route.host);
      textQuery = '';
    } else if (route.kind === 'invalid') {
      verdict.hidden = false;
      verdict.className = 'verdict verdict-unknown';
      verdict.textContent = '请提供公开 HTTP/HTTPS 网址，不包含用户名、密码或自定义端口。';
      candidates = [];
      textQuery = '';
    }
  }
  const result = queryCatalog(textQuery, candidates, { category: category.value, region: region.value, status: status.value, page });
  page = result.page;
  pages = result.pages;
  browse.hidden = true;
  results.hidden = false;
  const start = (page - 1) * result.pageSize + 1;
  info.textContent = result.total ? `共 ${result.total.toLocaleString('zh-CN')} 条，显示 ${start}–${start + result.items.length - 1} 条。来源收录尚未完成官网核验。` : '没有找到符合条件的记录。可清空筛选或换个名称重试。';
  results.replaceChildren(...(result.items.length ? result.items.map((s) => card(s, query)) : [el('li', { class: 'empty' },
    '没有匹配记录。也欢迎 ', el('a', { href: document.documentElement.dataset.submit, target: '_blank', rel: 'noopener noreferrer' }, '申请收录'), '。')]));
  pagination.hidden = result.total === 0;
  previous.disabled = page <= 1;
  next.disabled = page >= pages;
  pageInfo.textContent = `第 ${page} / ${pages} 页`;
}

async function load() {
  loaded = false;
  controls.forEach((control) => { control.disabled = true; });
  retry.hidden = true;
  loadStatus.hidden = false;
  loadStatus.textContent = '正在加载搜索。也可以直接浏览下方分类目录。';
  try {
    const response = await fetch(`${base}assets/sites.json?v=${document.documentElement.dataset.build}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || !data.every((s) => s && typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id) && typeof s.n === 'string' && typeof s.d === 'string' && typeof s.u === 'string' && Array.isArray(s.e) && Array.isArray(s.h) && Array.isArray(s.a) && Array.isArray(s.p) && Object.hasOwn(STATUS_LABELS, s.v))) throw new Error('Invalid index');
    index = data.sort((a, b) => Number(isVerified(b)) - Number(isVerified(a)) || a.n.localeCompare(b.n, 'zh-CN'));
    loaded = true;
    controls.forEach((control) => { control.disabled = false; });
    loadStatus.hidden = true;
    run();
  } catch {
    loadStatus.textContent = '搜索数据加载失败。请重试，或直接浏览下方分类目录。';
    retry.hidden = false;
    browse.hidden = false;
    results.hidden = true;
    verdict.hidden = true;
    pagination.hidden = true;
    info.textContent = '';
  }
}

function searchChanged() {
  clearTimeout(timer);
  if (!composing) timer = setTimeout(() => { page = 1; run(); }, 100);
}
input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
input.addEventListener('compositionend', () => { composing = false; searchChanged(); });
input.addEventListener('input', searchChanged);
for (const filter of [category, region, status]) filter.addEventListener('change', () => { page = 1; run(); });
clear.addEventListener('click', () => {
  clearTimeout(timer);
  input.value = ''; category.value = ''; region.value = ''; status.value = 'catalog'; page = 1;
  run(); input.focus();
});
for (const [button, direction] of [[previous, -1], [next, 1]]) button.addEventListener('click', () => {
  clearTimeout(timer);
  page = Math.max(1, Math.min(pages, page + direction)); run();
  info.scrollIntoView({ block: 'center' });
});
retry.addEventListener('click', load);
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !input.disabled &&
      !event.target.closest('input,textarea,select,[contenteditable]')) {
    event.preventDefault(); input.focus();
  }
});
load();
