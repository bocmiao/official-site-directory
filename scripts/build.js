import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadCategories, loadSites, loadSources, buildSearchIndex, validate } from './lib/data.js';
import { effectiveStatus, STATUS_LABELS, parseWebUrl } from '../src/search.js';
import { catalogStats } from './lib/stats.js';
import { TOPICS, topicName } from './lib/taxonomy.js';
import { displayName, displayDescription, LOCALIZATION_LABELS } from './lib/localization.js';

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
const regionDisplay = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const languageDisplay = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
const languageName = (code) => { try { return languageDisplay.of(code); } catch { return code; } };
const sourceName = (source) => source.id === 'ror' ? '全球研究机构注册目录（ROR）' : source.id === 'hipo-universities' ? 'Hipo 高校目录' : source.name;
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
<header><a class="brand" href="${base}">官网收录</a><p>找到所需入口，查看来源依据。</p><nav aria-label="主导航"><a href="${base}">搜索目录</a> · <a href="${base}sources.html">数据来源与质量</a> · <a href="${base}guide.html">收录与核验规则</a></nav></header>
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
<span class="card-name">${esc(displayName(s))}</span>${s.localization && displayName(s) !== s.name ? `<span class="card-original">${esc(s.name)}</span>` : ''}${s.localization && !['source', 'existing'].includes(s.localization.method) ? `<span class="name-method">${LOCALIZATION_LABELS[s.localization.method]}</span>` : ''}<span class="card-host ${verified ? '' : 'host-unverified'}">${esc(new URL(s.url).hostname)}</span>
<span class="card-desc">${esc(displayDescription(s))}</span></a>
<p class="card-status">${STATUS_LABELS[statusOf(s)]}${verified ? ` · ${esc(s.verified_at)}` : ''}</p>
<a class="card-detail" href="${base}site/${esc(s.id)}.html">查看入口与依据</a></li>`;
}

function indexPage(sites) {
  const verified = sites.filter((s) => statusOf(s) === 'verified');
  const pending = sites.filter((s) => ['pending', 'review'].includes(statusOf(s)));
  const sourced = sites.filter((s) => statusOf(s) === 'sourced');
  const regions = [...new Set(sites.map((s) => s.region).filter(Boolean))].sort((a, b) => regionName(a).localeCompare(regionName(b), 'zh-CN'));
  const body = `<h1>想找哪个官网？</h1>
<p class="intro">按名称、用途、别名或网址查找站点。收录 ${sites.length.toLocaleString('zh-CN')} 条记录，来源与核验状态公开可查。</p>
<p class="directory-note">教育考试与学习、在线工具、新闻资讯和游戏分开浏览，院校另设目录。中文译名供检索参考，保留原名与来源。</p>
<ul class="stats" aria-label="收录统计"><li><strong>${verified.length}</strong> 已核对来源</li><li><strong>${sourced.length.toLocaleString('zh-CN')}</strong> 来源收录，未核验</li><li><strong>${pending.length}</strong> 待审核或复核</li></ul>
<div class="search" role="search">
<label for="q">搜索名称或检查网址</label>
<input id="q" type="search" autocomplete="off" maxlength="500" disabled
 placeholder="例如：四六级报名、PDF 转换、游戏平台" aria-describedby="search-help">
<small id="search-help">支持中文、别名、拼音和空格分隔的多个关键词；粘贴网址可比对已登记的主机名。</small>
<div class="quick-filters" aria-label="快捷浏览"><span>快速查阅</span><button type="button" data-quick="education" disabled>教育与学习</button><button type="button" data-quick="tools" disabled>在线工具</button><button type="button" data-quick="news" disabled>新闻资讯</button><button type="button" data-quick="games" disabled>游戏</button><button type="button" data-quick="CN" disabled>内地院校</button><button type="button" data-quick="software" disabled>软件工具</button><button type="button" data-quick="overseas" disabled>海外院校</button><button type="button" data-quick="verified" disabled>已核对入口</button></div>
<div id="suggested-queries" class="quick-filters suggested-queries" aria-label="搜索示例"></div>
<details id="filter-panel" class="filter-panel" open><summary>分类、地区与更多筛选</summary><div class="filters">
<label for="category-filter">分类<select id="category-filter" disabled><option value="">全部分类</option>${categories.map((c) => `<option value="${c.id}">${esc(c.name)} (${stats.categories[c.id] || 0})</option>`).join('')}</select></label>
<label for="topic-filter">细分目录<select id="topic-filter" disabled><option value="">全部细分目录</option>${TOPICS.map((t) => `<option value="${t.id}" data-category="${t.category === 'institution' ? 'institutions-cn institutions-hmt institutions-global' : t.category}">${esc(t.name)}</option>`).join('')}</select></label>
<label for="region-filter">地区<select id="region-filter" disabled><option value="">全部地区</option>${regions.map((r) => `<option value="${r}">${esc(regionName(r))}</option>`).join('')}</select></label>
<label for="tag-filter">标签<select id="tag-filter" disabled><option value="">全部标签</option></select></label>
<label for="source-filter">资料来源<select id="source-filter" disabled><option value="">全部来源</option><option value="curated">人工整理</option>${manifest.sources.map((s) => `<option value="${s.id}">${esc(sourceName(s))}</option>`).join('')}</select></label>
<label for="status-filter">收录状态<select id="status-filter" disabled><option value="all">全部可见记录</option><option value="catalog">已核对 + 来源收录</option><option value="verified">仅已核对来源</option><option value="sourced">来源收录，未核验</option><option value="pending">待审核</option><option value="review">待复核</option></select></label>
<button id="clear-filters" type="button" disabled>清空条件</button></div></details>
</div>
<div id="active-filters" class="active-filters" aria-label="当前筛选条件"></div>
<p id="load-status" role="status">正在加载搜索。也可以直接浏览下方入口。</p>
<button id="retry" type="button" hidden>重新加载搜索</button>
<noscript><p>JavaScript 未启用，可以继续浏览下方入口和核验详情。</p></noscript>
<div class="results-toolbar"><p id="result-info" role="status" aria-live="polite"></p><div class="result-options"><label for="sort-order">排序<select id="sort-order" disabled><option value="relevance">相关度优先</option><option value="name">按名称排序</option></select></label><button id="view-toggle" type="button" aria-pressed="false" disabled>紧凑列表</button></div></div>
<div id="verdict" class="verdict" role="status" hidden></div>
<ul id="results" class="grid" hidden></ul>
<nav id="pagination" class="pagination" aria-label="搜索结果分页" hidden><button id="previous-page" type="button">上一页</button><span id="page-info"></span><button id="next-page" type="button">下一页</button></nav>
<div id="browse"><h2>已核对来源</h2><ul class="grid">${verified.map((s) => cardHtml(s)).join('')}</ul></div>
<section><h2>按分类浏览</h2><p class="muted">分类目录无需 JavaScript。第三方来源记录仅提供资料，需进一步核验。</p><ul class="category-list">${categories.map((c) => `<li><a href="./category/${c.id}/1.html">${esc(c.name)} <span>${stats.categories[c.id] || 0}</span></a></li>`).join('')}</ul></section>
<details class="policy"><summary>我们如何核对来源？</summary>
<p>已核对记录会说明主体、来源与具体入口的关系。来源收录仅表示第三方目录记录了这个地址，未完成官方身份核验，可以搜索但不提供直达，也不用于官网主机名匹配。</p>
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
<nav class="breadcrumbs" aria-label="当前位置"><a href="../">目录</a> / <a href="../?category=${esc(site.category)}">${esc(category.name)}</a> / ${esc(topicName(site.subcategory, categories))}</nav>
<h1>${esc(displayName(site))}</h1>${site.localization && displayName(site) !== site.name ? `<p class="original-name">原名：${esc(site.name)}</p>` : ''}<p class="status ${verified ? 'status-verified' : 'status-pending'}">${STATUS_LABELS[status]}</p>
${site.localization ? `<p class="name-method">${LOCALIZATION_LABELS[site.localization.method]}${['machine', 'editorial'].includes(site.localization.method) ? '：供中文检索参考，不代表机构采用的正式中文名称。' : ''}${site.localization.review_note ? ` · ${esc(site.localization.review_note)}` : ''}</p>` : ''}
${site.localization?.method === 'wikidata' ? `<p class="muted">中文名称来自${external(`https://www.wikidata.org/w/index.php?title=${site.localization.wikidata_id}&oldid=${site.localization.wikidata_revision}`, '维基数据固定版本')}（CC0）；社区整理名称不等于机构正式中文名称或官网核验。</p>` : ''}
<p>${esc(displayDescription(site))}</p>
<div class="tag-list">${site.tags.map((t) => `<a class="tag" href="../?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
${verified ? '' : '<p class="tip">这条记录尚未完成核验或需要复核，暂不提供直达按钮，也不作为官方身份的判断依据。</p>'}
<dl><dt>归属主体</dt><dd>${esc(site.owner || '待核对')}</dd><dt>分类</dt><dd>${esc(category.name)}</dd>
${site.region ? `<dt>地区</dt><dd>${esc(regionName(site.region))}</dd>` : ''}
${site.aliases.length ? `<dt>别名</dt><dd>${site.aliases.map(esc).join('、')}</dd>` : ''}
${site.verified_at ? `<dt>来源核对日期</dt><dd>${esc(site.verified_at)}</dd>
<dt>下次复核日期</dt><dd>${esc(site.review_due_at || '尚未安排')}</dd>
<dt>核对方式</dt><dd>${site.review_method === 'assisted' ? 'AI 辅助来源核对' : site.review_method === 'human' ? '人工核对' : '尚未核对'}</dd>
<dt>记录者</dt><dd>${esc(site.reviewer || '尚未记录')}</dd>` : ''}</dl>
${profileHtml(site)}
${verified ? `<h2>选择所需入口</h2><ul class="entry-list">${site.entries.map((e) => `<li>
${external(e.url, e.label)}<span>${esc(e.region)} · ${esc(e.language)}</span><code>${esc(e.url)}</code>
<small>依据：${site.evidence.map((item, i) => item.entry_ids.includes(e.id) ? `<a href="#evidence-${i}">${i + 1}</a>` : '').filter(Boolean).join('、')}</small>
</li>`).join('')}</ul>` : `<h2>待核对地址</h2><code id="candidate-address" class="candidate-url">${esc(site.url)}</code><button type="button" id="copy-address">复制待核对地址</button><span id="copy-status" role="status"></span>`}
${site.source ? `<h2>收录来源</h2><p>${external(site.source.url, sourceName(sourceById[site.source.id]) + (site.source.snapshot ? ' · 机构记录（可能更新）' : ' · 固定版本记录'))}${site.source.snapshot ? ` · ${external(site.source.snapshot, '本次使用的固定版本快照')}` : ''}</p><dl><dt>来源记录</dt><dd>${esc(site.source.record)}</dd><dt>采集日期</dt><dd>${esc(site.collected_at)}（不是核验日期）</dd><dt>来源许可证</dt><dd>${esc(sourceById[site.source.id].license)}</dd></dl><p>此地址来自第三方目录的 ${site.source.id === 'homebrew-cask' ? 'homepage' : site.source.id === 'ror' ? 'links[type=website]' : 'web_pages'} 字段，名称与地址可能过时。收录不代表品牌授权、办学资质或安全认证。<a href="../sources.html">查看来源与更新说明</a>。</p>${sourceById[site.source.id].attribution ? `<p class="muted">${esc(sourceById[site.source.id].attribution)}</p>` : ''}` : ''}
<h2>核验依据</h2>
${site.evidence.length ? `<ol class="evidence-list">${site.evidence.map((e, i) => `<li id="evidence-${i}">
${external(e.url, e.title)}<p>${esc(e.relation)}</p><small>关联入口：${e.entry_ids.map((id) => esc(labels[id])).join('、')}</small></li>`).join('')}</ol>` : '<p>尚未补充能确认官方归属的原始依据。提交时请说明主体与网址的关系，并附上官方原始来源链接。</p>'}
${verified ? '<p class="muted">来源核对仅覆盖列出的入口与核对日期，不自动覆盖同一域名的其他子域名或内容。</p>' : ''}
<h2>还需要补充什么</h2><ul>${missingInfo(site).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<p>${external(reportUrl(site), '提交纠错或补充依据')} · ${external(`${REPO_URL}/commits/HEAD/${site._file}`, '查看数据修改历史')}</p>
<h2>继续查阅</h2><p><a href="../?category=${site.category}&topic=${site.subcategory}">查看同一细分目录</a>${site.region ? ` · <a href="../?region=${site.region}&category=${site.category}">查看同地区记录</a>` : ''}</p>
</article>`;
  return layout({ title: `${displayName(site)} · ${STATUS_LABELS[status]}`, description: verified ? site.description : `${displayName(site)}候选记录，待核验。`,
    route: `site/${site.id}.html`, base: '../', body, noindex: !verified,
    scripts: `<script type="module" src="../assets/detail.js?v=${buildVersion}"></script>` });
}

function profileHtml(site) {
  const p = site.profile || {};
  const typeNames = { education: '教育', funder: '资助', facility: '科研设施', healthcare: '医疗', company: '企业', government: '政府', nonprofit: '非营利', archive: '档案', other: '其他' };
  const rows = [['细分目录', topicName(site.subcategory, categories)], ['登记主机名', new URL(site.url).hostname], ['连接协议', new URL(site.url).protocol === 'https:' ? 'HTTPS（不代表身份核验或当前可用）' : 'HTTP'], ['记录编号', site.id]];
  if (p.established) rows.push(['成立年份（来源记载）', String(p.established)]);
  if (p.locations?.length) rows.push(['所在地（来源记载）', p.locations.map((l) => [...new Set([regionName(l.country), l.subdivision, l.city].filter(Boolean))].join(' / ')).join('；')]);
  if (p.organization_types?.length) rows.push(['机构类型（ROR）', p.organization_types.map((t) => typeNames[t] || t).join('、')]);
  if (p.name_languages?.length) rows.push(['登记名称语言', p.name_languages.map(languageName).join('、') + '（不是网站支持语言）']);
  if (p.source_updated) rows.push(['上游资料更新', p.source_updated + '（不是网站检测日期）']);
  if (p.distribution) rows.push(['软件包目录', p.distribution]);
  if (p.package_platforms?.length) rows.push(['本次软件包平台', p.package_platforms.join('、') + '（不代表完整平台支持范围）']);
  if (p.cask_languages?.length) rows.push(['软件包语言选项', p.cask_languages.map(languageName).join('、') + '（不是网站语言）']);
  return `<h2>站点资料</h2><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="muted">细分目录与主题标签由名称、描述的规则整理，可能存在偏差，供检索参考。来源资料不替代官网核验；未列出的信息暂未收集。</p>`;
}

function missingInfo(site) {
  const fields = [];
  if (!site.owner) fields.push('归属主体及能够确认主体与网址关系的官方依据');
  if (statusOf(site) !== 'verified') fields.push('官网身份核验、核对日期与复核安排');
  if (!site.entries.some((e) => e.purpose !== 'home')) fields.push(site.category === 'software' ? '经核对的下载、文档或源码入口' : '经核对的办事、招生或其他具体服务入口（按实际用途补充）');
  if (!site.entries.length) fields.push('网站服务地区与支持语言（需实测或官方说明）');
  fields.push('当前连接可用性与最近一次检测结果');
  return fields;
}

function regionName(code) {
  return code === 'GLOBAL' ? '全球 / 未限定地区' : code === 'UNSPECIFIED' ? '未记录地区' : regionDisplay.of(code);
}

function categoryPage(category, records, page, pageSize = 60) {
  const pages = Math.max(1, Math.ceil(records.length / pageSize));
  const selected = records.slice((page - 1) * pageSize, page * pageSize);
  const pager = `<nav class="pagination" aria-label="分类分页">${page > 1 ? `<a href="${page - 1}.html">上一页</a>` : '<span>已是首页</span>'}<span>第 ${page} / ${pages} 页 · 共 ${records.length} 条</span>${page < pages ? `<a href="${page + 1}.html">下一页</a>` : '<span>已是末页</span>'}</nav>`;
  return layout({ title: `${category.name} · 第 ${page} 页`, description: `${category.name}目录，查看来源及核验状态。`, route: `category/${category.id}/${page}.html`, base: '../../', noindex: true,
    body: `<h1>${esc(category.name)}</h1><p>来源收录不等于已核验官网。<a href="../../">返回搜索筛选</a></p>${pager}<ul class="grid">${selected.map((s) => cardHtml(s, '../../')).join('')}</ul>${pager}` });
}

function sourcesPage() {
  return layout({ title: '数据来源与质量', description: '公开目录规模、来源许可、过滤规则与核验边界。', route: 'sources.html', body:
    `<h1>数据来源与质量</h1><p>统计构建于 ${today}。${stats.total} 条记录中，${stats.status.verified || 0} 条已核对来源，${stats.status.sourced || 0} 条仅为来源收录。数字表示记录数量，不表示已验证官网数量。</p>
    <h2>来源覆盖</h2><p>目前批量目录主要覆盖桌面软件、教育与研究机构；软件来源偏重 macOS 生态，机构名单可能存在历史名称与更新滞后，不代表完整的全球或中文官网库。ROR 本批仅收录 active 且类型包含 education 的机构；该状态是注册目录状态，不是本网核验结论。</p>
    <h2>为什么院校这么多？</h2><p>早期将全球机构批量目录与教育考试服务放在同一个分类。现在拆为教育考试与学习 ${stats.categories.education || 0} 条、内地院校与机构 ${stats.categories['institutions-cn'] || 0} 条、港澳台院校与机构 ${stats.categories['institutions-hmt'] || 0} 条、海外院校与机构 ${stats.categories['institutions-global'] || 0} 条。记录全部保留，数量不代表推荐程度。</p><h2>中文名称从哪里来？</h2><p>优先使用已有中文名称和维基数据中文标签，其余为本地模型生成的参考译名。机器译名尚未逐条人工校对；原名、来源记录和网址保持不变，仍支持原文搜索。维基数据标签按 CC0 提供，详情可查看所用版本。<a href="./data/localization.json" download>下载中文名称与翻译来源</a>。</p>
    <ul class="source-list">${manifest.sources.map((s) => `<li><h3>${external(s.url, sourceName(s))}</h3><p>${stats.sources[s.id] || 0} 条 · ${esc(s.license)} · 采集于 ${esc(s.collected_at)}</p><p><a href="./data/licenses/${s.license_file}">许可证全文</a>${(s.additional_license_files || []).map((file) => ` · <a href="./data/licenses/${file}">地区元数据许可</a>`).join('')} · ${external(s.download_url, '上游数据入口')}</p><p class="muted">每条详情保留来源记录和固定提交或版本快照，SHA-256 见来源清单。</p>${s.attribution ? `<p>${esc(s.attribution)}</p>` : ''}</li>`).join('')}</ul>
    <h2>清洗规则</h2><p>只批量收录上游明确列出的 HTTPS 首页；不把 HTTP 地址擅自改成 HTTPS。不导入安装包、字体、停用软件、版本变体、带凭据或参数的地址。按归一化首页去重，人工维护记录优先。HTTPS 只是收录条件，不证明网站归属或可用性。</p>
    <dl class="quality-counts"><dt>不同主机名</dt><dd>${stats.unique_hosts}</dd><dt>有来源链的批量记录</dt><dd>${stats.imported_with_source}</dd><dt>已核对具体入口</dt><dd>${stats.verified_entries}</dd></dl>
    <h2>数据下载</h2><p><a href="./data/catalog.json" download>完整目录 JSON</a> · <a href="./data/quality.json" download>质量统计 JSON</a> · <a href="./data/sources.json" download>来源版本与过滤统计</a></p><p>导出的字段和状态与页面一致，勿把 sourced 当作 verified。第三方派生字段遵循上游许可证；本项目原创内容暂未授予独立复用许可。</p><h2>发现问题</h2><p>详情页可提交纠错；维护者在独立修订文件保留更正或撤销记录，刷新来源不会清除修订。来源更新须先完成校验，再提交 main；构建通过后发布。</p>` });
}

function guidePage() {
  return layout({ title: '收录与核验规则', description: '理解收录状态、核验流程和如何贡献官网记录。', route: 'guide.html', body:
    `<h1>找到地址，也看清依据</h1><h2>四种可见状态</h2><ul><li><strong>已核对来源：</strong>逐项记录主体、入口与来源的关系，有核对方式、记录者和复核日期。</li><li><strong>来源收录，未核验：</strong>第三方目录中有记录，可以搜索和查看来源，尚不能确认其官方归属。</li><li><strong>待审核：</strong>仍需补充或审阅材料。</li><li><strong>待复核：</strong>核验已过期或有疑问，暂停直达。</li></ul>
    <h2>怎么搜索</h2><p>名称支持中文、原文、别名和中文译名的拼音。网页默认显示全部可见记录，已核对入口与国内常用服务优先。可切换为仅已核对来源；机器译名不是官网核验。可组合分类、细分目录、地区、标签、来源和状态筛选，支持名称排序和紧凑列表。输入“Python 下载”会优先选择已登记下载入口；未收录的用途不会凭空生成地址。搜索和粘贴的网址不会写入浏览器 URL 或历史。</p><h2>网址比对的范围</h2><p>仅比较已核对入口的完整主机名，保留 www 与其他子域名的区别。匹配不验证任意路径、网页当前内容或下载文件；相似和未收录都不等于仿冒。来源收录不参与主机名认证。</p><h2>贡献一条记录</h2><ol><li>先搜索名称及网址，避免重复。</li><li>提供准确名称、入口用途、主体和官方原始来源。</li><li>说明来源怎样链接到目标入口；不要只提供搜索截图或排名。</li><li>经审阅后更新核验状态，后续按日期复核。</li></ol><p>${external(submitUrl, '申请收录')} · ${external(`${REPO_URL}/blob/HEAD/docs/DESIGN.md`, '维护者数据规范')}</p>` });
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
const manifest = loadSources();
const sourceById = Object.fromEntries(manifest.sources.map((s) => [s.id, s]));
const stats = catalogStats(sites, today);
const indexJson = JSON.stringify(buildSearchIndex(sites, today));
const sourceFiles = Object.fromEntries(['app.js', 'search.js', 'detail.js', 'style.css'].map((file) => [file, fs.readFileSync(path.join(ROOT, 'src', file), 'utf8')]));
const buildVersion = createHash('sha256').update(indexJson + JSON.stringify(sourceFiles)).digest('hex').slice(0, 12);
// Only this fixed build directory is replaced; no user-controlled output path.
if (path.resolve(OUT) !== path.resolve(ROOT, 'dist')) throw new Error('Unexpected output directory');
fs.rmSync(OUT, { recursive: true, force: true });
write('index.html', indexPage(sites));
for (const site of sites) write(`site/${site.id}.html`, sitePage(site, catById[site.category]));
for (const category of categories) {
  const records = sites.filter((s) => s.category === category.id && statusOf(s) !== 'withdrawn').sort((a, b) => Number(statusOf(b) === 'verified') - Number(statusOf(a) === 'verified') || displayName(a).localeCompare(displayName(b), 'zh-CN'));
  for (let page = 1; page <= Math.max(1, Math.ceil(records.length / 60)); page++) write(`category/${category.id}/${page}.html`, categoryPage(category, records, page));
}
write('sources.html', sourcesPage());
write('guide.html', guidePage());
write('data/catalog.json', JSON.stringify(sites.map(({ _file, ...site }) => site)));
write('data/quality.json', JSON.stringify(stats, null, 2));
write('data/sources.json', JSON.stringify(manifest, null, 2));
const localizationFile = path.join(ROOT, 'data/localization/zh-CN.json');
if (fs.existsSync(localizationFile)) write('data/localization.json', fs.readFileSync(localizationFile, 'utf8'));
for (const source of manifest.sources) for (const file of [source.license_file, ...(source.additional_license_files || [])]) write(`data/licenses/${file}`, fs.readFileSync(path.join(ROOT, 'data/licenses', file), 'utf8'));
write('assets/sites.json', indexJson);
for (const [file, content] of Object.entries(sourceFiles)) write(`assets/${file}`, file === 'app.js' ? content.replace("'./search.js'", `'./search.js?v=${buildVersion}'`) : content);
if (SITE_URL) {
  const records = [{ route: '', modified: null }, ...sites.filter((s) => statusOf(s) === 'verified').map((s) => ({ route: `site/${s.id}.html`, modified: s.verified_at }))];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${records.map((r) => `<url><loc>${esc(`${SITE_URL}/${r.route}`)}</loc>${r.modified ? `<lastmod>${r.modified}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`);
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
} else write('robots.txt', 'User-agent: *\nDisallow: /\n');
console.log(`✓ ${sites.length} 条记录，${stats.status.verified || 0} 条已核对，${stats.status.sourced || 0} 条来源收录；已生成分页分类目录、详情与质量报告。${SITE_URL ? '' : '本地预览未生成 canonical/sitemap。'}`);
