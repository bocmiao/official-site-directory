// 纯函数搜索逻辑：浏览器与 Node 测试共用，不依赖 DOM。

// 用户习惯在关键词后加“官网”“下载”等后缀，匹配前去掉
const SUFFIX_RE = /(官方网站|官方网址|官网|官方|网址|网站|首页|入口|登录|登陆|下载|app)+$/i;

export function normalizeQuery(q) {
  let s = String(q ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const stripped = s.replace(SUFFIX_RE, '');
  return stripped || s;
}

/** 如果输入像网址/域名，返回去掉 www. 的主机名，否则返回 null */
export function extractHost(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw || /[一-龥\s]/.test(raw) || !/[a-z0-9-]\.[a-z]{2,}/.test(raw)) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//.test(raw) ? raw : 'http://' + raw);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const isOfficialHost = (host, official) => host === official || host.endsWith('.' + official);

/**
 * 网址鉴别：判断一个域名是否属于已收录官网。
 * 返回 { status: 'official' | 'suspicious' | 'unknown', site?, host }
 */
export function checkHost(host, index) {
  for (const site of index) {
    if (site.h.some((h) => isOfficialHost(host, h))) return { status: 'official', site, host };
  }
  // 仿冒特征：包含官方域名的主体部分（如 12306-cn.com），或与官方域名只差 1~2 个字符
  for (const site of index) {
    for (const h of site.h) {
      const label = h.split('.')[0];
      const maxDist = h.length >= 10 ? 2 : h.length >= 6 ? 1 : 0;
      if ((label.length >= 4 && host.includes(label)) || (maxDist && levenshtein(host, h) <= maxDist)) {
        return { status: 'suspicious', site, host };
      }
    }
  }
  return { status: 'unknown', host };
}

function scoreText(q, text) {
  const t = text.toLowerCase().replace(/\s+/g, '');
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  return 0;
}

export function search(query, index, limit = 20) {
  const q = normalizeQuery(query);
  if (!q) return [];
  const ascii = /^[a-z0-9]+$/.test(q);
  const results = [];
  for (const site of index) {
    let score = 0;
    for (const t of [site.n, ...site.a]) score = Math.max(score, scoreText(q, t));
    if (ascii && score < 70) {
      for (const p of site.p) {
        if (p === q) score = Math.max(score, 70);
        else if (q.length >= 2 && p.startsWith(q)) score = Math.max(score, 50);
      }
    }
    if (score < 40 && q.length >= 2 && site.h.some((h) => h.includes(q))) score = 40;
    if (score < 15 && q.length >= 2 && site.d.toLowerCase().includes(q)) score = 15;
    if (score > 0) results.push({ site, score });
  }
  results.sort((a, b) => b.score - a.score || a.site.n.length - b.site.n.length);
  return results.slice(0, limit).map((r) => r.site);
}
