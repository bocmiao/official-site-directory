import { search, extractHost, checkHost } from './search.js';

const $ = (sel) => document.querySelector(sel);
const input = $('#q');
const results = $('#results');
const verdict = $('#verdict');
const browse = $('#browse');
const base = document.documentElement.dataset.base || './';

let index = [];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function card(site) {
  const host = new URL(site.u).host;
  return el(
    'li',
    { class: 'card' },
    el('a', { class: 'card-main', href: site.u, target: '_blank', rel: 'noopener noreferrer' },
      el('span', { class: 'card-name' }, site.n),
      el('span', { class: 'card-host' }, host),
      el('span', { class: 'card-desc' }, site.d),
    ),
    ...(site.w ? [el('p', { class: 'card-note' }, '⚠️ ' + site.w)] : []),
    el('a', { class: 'card-detail', href: `${base}site/${site.id}.html` }, '详情与核验 ›'),
  );
}

function renderVerdict(host) {
  const r = checkHost(host, index);
  verdict.hidden = false;
  verdict.className = 'verdict verdict-' + r.status;
  verdict.replaceChildren();
  if (r.status === 'official') {
    verdict.append(`✅ ${host} 属于已收录的「${r.site.n}」官方域名。`);
  } else if (r.status === 'suspicious') {
    verdict.append(
      `🚨 ${host} 不是已收录的官方域名，并且与「${r.site.n}」的官网 `,
      el('b', {}, r.site.h[0]),
      ' 很像，疑似仿冒网站，请勿输入账号、密码或付款！',
    );
  } else {
    verdict.append(
      `⚠️ ${host} 暂未收录。不代表一定是假网站，建议到 `,
      el('a', { href: 'https://beian.miit.gov.cn', target: '_blank', rel: 'noopener' }, '工信部 ICP 备案查询'),
      ' 核对主办单位。',
    );
  }
  return r.site ? [r.site] : [];
}

function run() {
  const q = input.value;
  const url = new URL(location.href);
  if (q.trim()) url.searchParams.set('q', q.trim());
  else url.searchParams.delete('q');
  history.replaceState(null, '', url);

  verdict.hidden = true;
  if (!q.trim()) {
    results.hidden = true;
    browse.hidden = false;
    return;
  }
  const host = extractHost(q);
  const list = host ? renderVerdict(host) : search(q, index);
  browse.hidden = true;
  results.hidden = false;
  results.replaceChildren(
    ...(list.length
      ? list.map(card)
      : host
        ? []
        : [el('li', { class: 'empty' }, '没有找到。可以换个说法（简称、拼音、首字母），或 ',
            el('a', { href: document.documentElement.dataset.submit, target: '_blank', rel: 'noopener' }, '申请收录'), '。')]),
  );
}

input.addEventListener('input', run);
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
  }
});

fetch(`${base}assets/sites.json`)
  .then((r) => r.json())
  .then((data) => {
    index = data;
    const q = new URL(location.href).searchParams.get('q');
    if (q) input.value = q;
    run();
  });
