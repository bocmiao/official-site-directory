// 把 data/ 下的 YAML 生成为纯静态站点，输出到 dist/。
// 环境变量：
//   SITE_URL  站点正式域名，用于 canonical 与 sitemap（例如 https://guanwang.example.com）
//   REPO_URL  GitHub 仓库地址，用于“申请收录 / 纠错”链接
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadCategories, loadSites, buildSearchIndex, hostOf } from './lib/data.js';

const SITE_URL = (process.env.SITE_URL || 'https://example.com').replace(/\/$/, '');
const REPO_URL = (process.env.REPO_URL || 'https://github.com/bocmiao/official-site-directory').replace(/\/$/, '');
const SITE_NAME = '官网收录';
const OUT = path.join(ROOT, 'dist');

const submitUrl = `${REPO_URL}/issues/new?template=submit-site.yml`;
const reportUrl = (site) =>
  `${REPO_URL}/issues/new?template=report.yml&title=${encodeURIComponent(`[纠错] ${site.name}`)}`;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout({ title, description, canonical, base, body, scripts = '' }) {
  return `<!doctype html>
<html lang="zh-CN" data-base="${base}" data-submit="${esc(submitUrl)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🔎</text></svg>">
<link rel="stylesheet" href="${base}assets/style.css">
</head>
<body>
<div class="wrap">
<header>
  <h1><a href="${base}">🔎 ${SITE_NAME}</a></h1>
  <p>只收录经过核验的官方网站 · 无广告 · 无竞价排名</p>
</header>
${body}
<footer>
  <p>找不到想要的官网？<a href="${esc(submitUrl)}" target="_blank" rel="noopener">申请收录</a> ·
  数据开源，欢迎 <a href="${REPO_URL}" target="_blank" rel="noopener">在 GitHub 上参与维护</a></p>
  <p>本站仅提供官网链接，不代理任何业务。遇到要求输入银行卡、验证码的陌生网站，请先核对域名。</p>
</footer>
</div>
${scripts}
</body>
</html>
`;
}

function cardHtml(s, base) {
  return `<li class="card">
  <a class="card-main" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
    <span class="card-name">${esc(s.name)}</span>
    <span class="card-host">${esc(new URL(s.url).host)}</span>
    <span class="card-desc">${esc(s.description)}</span>
  </a>
  ${s.note ? `<p class="card-note">⚠️ ${esc(s.note)}</p>` : ''}
  <a class="card-detail" href="${base}site/${esc(s.id)}.html">详情与核验 ›</a>
</li>`;
}

function indexPage(categories, sites) {
  const sections = categories
    .map((c) => {
      const list = sites.filter((s) => s.category === c.id);
      if (!list.length) return '';
      return `<section id="${esc(c.id)}">
<h2>${esc(c.icon ?? '')} ${esc(c.name)}</h2>
<ul class="grid">
${list.map((s) => cardHtml(s, './')).join('\n')}
</ul>
</section>`;
    })
    .join('\n');

  const body = `<div class="search">
  <input id="q" type="search" autocomplete="off" autofocus
    placeholder="输入名称、简称、拼音或首字母，如：12306、工行、xuexinwang、zsyh"
    aria-label="搜索官网">
  <small>也可以粘贴一个网址，检查它是不是官网 · 按 / 快速聚焦</small>
</div>
<div id="verdict" class="verdict" hidden></div>
<ul id="results" class="grid" hidden></ul>
<div id="browse">
${sections}
</div>`;

  return layout({
    title: `${SITE_NAME} - 一眼找到真官网，远离仿冒与广告`,
    description: `收录 ${sites.length} 个经过核验的官方网站，支持中文、拼音、首字母搜索和网址真伪鉴别。`,
    canonical: `${SITE_URL}/`,
    base: './',
    body,
    scripts: '<script type="module" src="./assets/app.js"></script>',
  });
}

function sitePage(site, category, related) {
  const host = hostOf(site.url);
  const body = `<article class="detail">
  <h1>${esc(site.name)}官网</h1>
  <p>${esc(site.description)}</p>
  <a class="official-url" href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">${esc(site.url)}</a>
  ${site.note ? `<p class="tip">⚠️ ${esc(site.note)}</p>` : ''}
  <dl>
    <dt>官方域名</dt><dd>${[host, ...site.domains].map(esc).join('、')}</dd>
    ${site.aliases.length ? `<dt>也叫</dt><dd>${site.aliases.map(esc).join('、')}</dd>` : ''}
    <dt>分类</dt><dd><a href="../#${esc(category.id)}">${esc(category.name)}</a></dd>
    ${site.icp ? `<dt>ICP 备案</dt><dd>${esc(site.icp)}</dd>` : ''}
  </dl>
  <h2>如何确认是真官网？</h2>
  <ol>
    <li>看地址栏：域名应当是 <b>${esc(host)}</b>${site.domains.length ? ' 或上面列出的其他官方域名' : ''}，注意 ${esc(host)}-xxx.com、${esc(host.split('.')[0])}.xyz 这类仿冒写法。</li>
    <li>搜索结果里标有“广告”“推广”“赞助”的链接，不一定是官网。</li>
    <li>中国大陆网站可在 <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener">工信部 ICP 备案系统</a> 查询域名的主办单位。</li>
  </ol>
  <p>信息有误或官网已变更？<a href="${esc(reportUrl(site))}" target="_blank" rel="noopener">提交纠错</a></p>
</article>
${related.length ? `<h2>同类官网</h2><ul class="grid">${related.map((s) => cardHtml(s, '../')).join('\n')}</ul>` : ''}`;

  return layout({
    title: `${site.name}官网_${site.name}官方网站入口 - ${SITE_NAME}`,
    description: `${site.name}官方网站是 ${site.url}。${site.description}。`,
    canonical: `${SITE_URL}/site/${site.id}.html`,
    base: '../',
    body,
  });
}

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const categories = loadCategories();
const sites = loadSites();
const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

fs.rmSync(OUT, { recursive: true, force: true });

write('index.html', indexPage(categories, sites));
for (const site of sites) {
  const related = sites.filter((s) => s.category === site.category && s.id !== site.id).slice(0, 6);
  write(`site/${site.id}.html`, sitePage(site, catById[site.category], related));
}

write('assets/sites.json', JSON.stringify(buildSearchIndex(sites)));
for (const f of ['app.js', 'search.js', 'style.css']) {
  fs.copyFileSync(path.join(ROOT, 'src', f), path.join(OUT, 'assets', f));
}

const today = new Date().toISOString().slice(0, 10);
const urls = [`${SITE_URL}/`, ...sites.map((s) => `${SITE_URL}/site/${s.id}.html`)];
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`,
);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);

console.log(`✓ 已生成 dist/：首页 + ${sites.length} 个官网详情页 + sitemap.xml`);
