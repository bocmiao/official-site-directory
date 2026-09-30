import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadCategories, loadSites, buildSearchIndex, validate } from './lib/data.js';
import { effectiveStatus, STATUS_LABELS, parseWebUrl } from '../src/search.js';

const production = process.argv.includes('--production');
const configuredUrl = process.env.SITE_URL?.trim();
const siteUrl = configuredUrl ? parseWebUrl(configuredUrl) : null;
if ((configuredUrl && (!siteUrl || siteUrl.search || siteUrl.hash)) ||
    (production && (!siteUrl || siteUrl.protocol !== 'https:' || /(^|\.)example\.(com|org|net)$/.test(siteUrl.hostname)))) {
  throw new Error('发布构建必须设置真实的 HTTPS SITE_URL（可包含仓库子路径），不能使用示例域名。');
}
const SITE_URL = siteUrl?.href.replace(/\/$/, '');
const REPO_URL = 'https://github.com/bocmiao/official-site-directory';
const OUT = path.join(ROOT, 'dist');
const today = new Date().toISOString().slice(0, 10);
const submitUrl = `${REPO_URL}/issues/new?template=submit-site.yml`;
const reportUrl = (site) => `${REPO_URL}/issues/new?template=report.yml&title=${encodeURIComponent(`[纠错] ${site.name}`)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const statusOf = (s) => effectiveStatus(s.verification_status, s.review_due_at, today);
const external = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;

function layout({ title, description, route = '', base = './', body, scripts = '', noindex = false }) {
  return `<!doctype html>
<html lang="zh-CN" data-base="${base}" data-build="${buildVersion}" data-submit="${esc(submitUrl)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - 官网收录</title>
<meta name="description" content="${esc(description)}">
<meta name="referrer" content="no-referrer">
${noindex || !SITE_URL ? '<meta name="robots" content="noindex,follow">' : ''}
${SITE_URL ? `<link rel="canonical" href="${esc(`${SITE_URL}/${route}`)}">` : ''}
<link rel="stylesheet" href="${base}assets/style.css?v=${buildVersion}">
</head>
<body><div class="wrap">
<a class="skip-link" href="#main">跳到主要内容</a>
<header><a class="brand" href="${base}">官网收录</a><p>找到所需入口，查看核验依据。</p></header>
<main id="main">${body}</main>
<footer>
<p>${external(submitUrl, '申请收录')} · ${external(REPO_URL, '在 GitHub 上参与维护')}（提交需要 GitHub 账号）</p>
<p>来源核对不等于品牌授权或安全认证。本站不代理下载、登录或交易。</p>
</footer></div>${scripts}</body></html>`;
}

function cardHtml(s, base = './') {
  const verified = statusOf(s) === 'verified';
  const href = verified ? s.url : `${base}site/${s.id}.html`;
  return `<li class="card">
<a class="card-main" href="${esc(href)}" ${verified ? 'target="_blank" rel="noopener noreferrer"' : ''}>
<span class="card-name">${esc(s.name)}</span><span class="card-host">${esc(new URL(s.url).hostname)}</span>
<span class="card-desc">${verified ? esc(s.description) : '候选记录，尚未完成来源核对。'}</span></a>
<p class="card-status">${STATUS_LABELS[statusOf(s)]}${verified ? ` · ${esc(s.verified_at)}` : ''}</p>
<a class="card-detail" href="${base}site/${esc(s.id)}.html">查看入口与依据</a></li>`;
}

function indexPage(sites) {
  const verified = sites.filter((s) => statusOf(s) === 'verified');
  const pending = sites.filter((s) => ['pending', 'review'].includes(statusOf(s)));
  const body = `<h1>想找哪个官网？</h1>
<p class="intro">截至 ${today}，${verified.length} 个产品已核对来源，${pending.length} 条候选待审核或复核。每个入口都可以查看依据。</p>
<div class="search" role="search">
<label for="q">搜索名称或检查网址</label>
<input id="q" type="search" autocomplete="off" maxlength="500" disabled
 placeholder="例如：Node.js、Python 下载、VS Code 文档" aria-describedby="search-help">
<small id="search-help">支持中文、别名和拼音；粘贴网址可比对已登记的主机名。</small>
<label class="filter"><input id="include-pending" type="checkbox" disabled> 包含待审核记录（仅查看资料）</label>
</div>
<p id="load-status" role="status">正在加载搜索。也可以直接浏览下方入口。</p>
<button id="retry" type="button" hidden>重新加载搜索</button>
<noscript><p>JavaScript 未启用，可以继续浏览下方入口和核验详情。</p></noscript>
<p id="result-info" role="status" aria-live="polite"></p>
<div id="verdict" class="verdict" role="status" hidden></div>
<ul id="results" class="grid" hidden></ul>
<div id="browse"><h2>已核对来源</h2><ul class="grid">${verified.map((s) => cardHtml(s)).join('')}</ul></div>
<details class="review-list"><summary>待审核与待复核清单（${pending.length}）</summary>
<p>这些候选不进入默认搜索，也不用于确认网址。欢迎补充来源依据。</p>
<ul>${pending.map((s) => `<li><a href="./site/${esc(s.id)}.html">${esc(s.name)}</a> · ${STATUS_LABELS[statusOf(s)]}</li>`).join('')}</ul></details>
<details class="policy"><summary>我们如何核对来源？</summary>
<p>记录主体、官方项目或组织的来源链接，并核对来源如何指向具体入口。备案、证书、域名外观和搜索排名不能单独证明产品归属。</p>
<p>辅助核对会明确标注方法与记录者。到期记录进入待复核状态；连接检测与身份核验分开处理。主机名匹配不验证任意路径、下载文件或网页当前内容。</p>
</details>`;
  return layout({ title: '查找官网与官方入口', description: '查询有来源依据的官网、下载和文档入口；待审核记录单独标识。', body,
    scripts: `<script type="module" src="./assets/app.js?v=${buildVersion}"></script>` });
}

function sitePage(site, category) {
  const status = statusOf(site);
  const verified = status === 'verified';
  const labels = Object.fromEntries(site.entries.map((e) => [e.id, e.label]));
  const body = `<article class="detail">
<h1>${esc(site.name)}</h1><p class="status ${verified ? 'status-verified' : 'status-pending'}">${STATUS_LABELS[status]}</p>
${verified ? `<p>${esc(site.description)}</p>` : '<p>这条记录尚未完成核验或需要复核，暂不提供直达按钮，也不作为官方身份的判断依据。</p>'}
<dl><dt>归属主体</dt><dd>${esc(site.owner || '待核对')}</dd><dt>分类</dt><dd>${esc(category.name)}</dd>
${site.aliases.length ? `<dt>别名</dt><dd>${site.aliases.map(esc).join('、')}</dd>` : ''}
<dt>来源核对日期</dt><dd>${esc(site.verified_at || '尚未核对')}</dd>
<dt>下次复核日期</dt><dd>${esc(site.review_due_at || '尚未安排')}</dd>
<dt>核对方式</dt><dd>${site.review_method === 'assisted' ? 'AI 辅助来源核对' : site.review_method === 'human' ? '人工核对' : '尚未核对'}</dd>
<dt>记录者</dt><dd>${esc(site.reviewer || '尚未记录')}</dd></dl>
${verified ? `<h2>选择所需入口</h2><ul class="entry-list">${site.entries.map((e) => `<li>
${external(e.url, e.label)}<span>${esc(e.region)} · ${esc(e.language)}</span><code>${esc(e.url)}</code>
<small>依据：${site.evidence.map((item, i) => item.entry_ids.includes(e.id) ? `<a href="#evidence-${i}">${i + 1}</a>` : '').filter(Boolean).join('、')}</small>
</li>`).join('')}</ul>` : `<h2>待核对地址</h2><code class="candidate-url">${esc(site.url)}</code>`}
<h2>核验依据</h2>
${site.evidence.length ? `<ol class="evidence-list">${site.evidence.map((e, i) => `<li id="evidence-${i}">
${external(e.url, e.title)}<p>${esc(e.relation)}</p><small>关联入口：${e.entry_ids.map((id) => esc(labels[id])).join('、')}</small></li>`).join('')}</ol>` : '<p>尚未补充可追溯的来源。提交时请说明主体与网址的关系，并附上原始来源链接。</p>'}
<p class="muted">来源核对仅覆盖列出的入口与核对日期，不自动覆盖同一域名的其他子域名或内容。</p>
<p>${external(reportUrl(site), '提交纠错或补充依据')} · ${external(`${REPO_URL}/commits/HEAD/${site._file}`, '查看数据修改历史')}</p>
</article>`;
  return layout({ title: `${site.name} · ${STATUS_LABELS[status]}`, description: verified ? site.description : `${site.name}候选记录，待核验。`,
    route: `site/${site.id}.html`, base: '../', body, noindex: !verified });
}

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const categories = loadCategories();
const sites = loadSites();
const errors = validate(categories, sites);
if (errors.length) throw new Error(errors.join('\n'));
const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
const indexJson = JSON.stringify(buildSearchIndex(sites, today));
const sourceFiles = Object.fromEntries(['app.js', 'search.js', 'style.css'].map((file) => [file, fs.readFileSync(path.join(ROOT, 'src', file), 'utf8')]));
const buildVersion = createHash('sha256').update(indexJson + JSON.stringify(sourceFiles)).digest('hex').slice(0, 12);
// Only this fixed build directory is replaced; no user-controlled output path.
if (path.resolve(OUT) !== path.resolve(ROOT, 'dist')) throw new Error('Unexpected output directory');
fs.rmSync(OUT, { recursive: true, force: true });
write('index.html', indexPage(sites));
for (const site of sites) write(`site/${site.id}.html`, sitePage(site, catById[site.category]));
write('assets/sites.json', indexJson);
for (const [file, content] of Object.entries(sourceFiles)) write(`assets/${file}`, file === 'app.js' ? content.replace("'./search.js'", `'./search.js?v=${buildVersion}'`) : content);
if (SITE_URL) {
  const records = [{ route: '', modified: null }, ...sites.filter((s) => statusOf(s) === 'verified').map((s) => ({ route: `site/${s.id}.html`, modified: s.verified_at }))];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${records.map((r) => `<url><loc>${esc(`${SITE_URL}/${r.route}`)}</loc>${r.modified ? `<lastmod>${r.modified}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`);
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
} else write('robots.txt', 'User-agent: *\nDisallow: /\n');
console.log(`✓ 已生成首页与 ${sites.length} 个详情页；${sites.filter((s) => statusOf(s) === 'verified').length} 个产品进入默认目录。${SITE_URL ? '' : '本地预览未生成 canonical/sitemap。'}`);
