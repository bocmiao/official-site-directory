import { search, resolveInput, checkHost, preferredEntry, isVerified, effectiveStatus, STATUS_LABELS } from './search.js';

const $ = (selector) => document.querySelector(selector);
const input = $('#q');
const includePending = $('#include-pending');
const results = $('#results');
const verdict = $('#verdict');
const browse = $('#browse');
const info = $('#result-info');
const loadStatus = $('#load-status');
const retry = $('#retry');
const base = document.documentElement.dataset.base || './';
let index = [];
let loaded = false;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function card(site, query) {
  const entry = preferredEntry(site, query);
  const detail = `${base}site/${site.id}.html`;
  const status = effectiveStatus(site.v, site.due);
  return el('li', { class: 'card' },
    el('a', { class: 'card-main', href: entry?.url ?? detail, ...(entry ? { target: '_blank', rel: 'noopener noreferrer' } : {}) },
      el('span', { class: 'card-name' }, site.n),
      el('span', { class: 'card-host' }, entry ? new URL(entry.url).hostname : '候选记录 · 暂不提供直达'),
      el('span', { class: 'card-desc' }, entry ? site.d : '尚未完成来源核对，查看资料或补充依据。'),
      ...(entry ? [el('span', { class: 'entry-purpose' }, `${entry.label} · ${entry.region}`)] : [])),
    el('p', { class: 'card-status' }, `${STATUS_LABELS[status]}${entry ? ` · ${site.checked}` : ''}`),
    el('a', { class: 'card-detail', href: detail }, '查看入口与依据'));
}

function renderVerdict(host) {
  const result = checkHost(host, index);
  verdict.hidden = false;
  verdict.className = `verdict verdict-${result.status}`;
  if (result.status === 'matched') {
    verdict.textContent = `${host} 与已核对入口的主机名一致。仅比对主机名，不验证当前路径、网页内容或下载文件。请使用下方已登记入口。`;
  } else if (result.status === 'similar') {
    verdict.textContent = `${host} 未匹配已核对入口，与下方部分入口的名称相似。相似不代表仿冒，未收录也不代表不安全，请进一步核对来源。`;
  } else {
    verdict.textContent = `${host} 暂无已核对的匹配记录。未收录不代表是假网站，可提交来源供审核。`;
  }
  return result.matches;
}

function run() {
  if (!loaded) return;
  const query = input.value.trim();
  verdict.hidden = true;
  // Do not put pasted URLs, tokens or login parameters into this page's URL/history.
  let list;
  if (!query) {
    list = index.filter((s) => includePending.checked || isVerified(s));
  } else {
    const route = resolveInput(query, index);
    if (route.kind === 'host') list = renderVerdict(route.host);
    else if (route.kind === 'invalid') {
      verdict.hidden = false;
      verdict.className = 'verdict verdict-unknown';
      verdict.textContent = '请提供公开 HTTP/HTTPS 网址，不包含用户名、密码或自定义端口。';
      list = [];
    } else list = search(query, index, { includePending: includePending.checked });
  }
  browse.hidden = true;
  results.hidden = false;
  info.textContent = list.length ? `显示 ${list.length} 条记录${includePending.checked ? '（含待审核或待复核）' : '，仅显示已核对来源的入口'}。` : '没有找到符合条件的记录。';
  results.replaceChildren(...(list.length ? list.map((s) => card(s, query)) : [el('li', { class: 'empty' },
    '可以换个名称，或查看待审核记录。也欢迎 ',
    el('a', { href: document.documentElement.dataset.submit, target: '_blank', rel: 'noopener noreferrer' }, '申请收录'), '。')]));
}

async function load() {
  loaded = false;
  input.disabled = true;
  includePending.disabled = true;
  retry.hidden = true;
  loadStatus.hidden = false;
  loadStatus.textContent = '正在加载搜索。也可以直接浏览下方入口。';
  try {
    const response = await fetch(`${base}assets/sites.json?v=${document.documentElement.dataset.build}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || !data.every((s) => s && typeof s.n === 'string' && Array.isArray(s.e) && Array.isArray(s.h))) throw new Error('Invalid index');
    index = data;
    loaded = true;
    input.disabled = false;
    includePending.disabled = false;
    loadStatus.hidden = true;
    run();
  } catch {
    loadStatus.textContent = '搜索数据加载失败。请重试，或直接浏览下方入口。';
    retry.hidden = false;
    browse.hidden = false;
    results.hidden = true;
    verdict.hidden = true;
    info.textContent = '';
  }
}

input.addEventListener('input', run);
includePending.addEventListener('change', run);
retry.addEventListener('click', load);
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !input.disabled &&
      !event.target.closest('input,textarea,select,[contenteditable]')) {
    event.preventDefault();
    input.focus();
  }
});
load();
