# 🔎 官网收录

> 只收录经过核验的官方网站 · 无广告 · 无竞价排名

搜索引擎里搜“XX官网”，前面常常是广告、下载站甚至仿冒网站。这个项目维护一份**开源、可溯源的官网目录**，并提供：

- **搜索**：全称、简称、拼音、首字母都能搜（`12306`、`工行`、`xuexinwang`、`zsyh`）
- **网址鉴别**：粘贴一个网址，告诉你它是 ✅ 官网、🚨 疑似仿冒，还是 ⚠️ 未收录
- **官网详情页**：官方地址、全部官方域名、防骗提示、纠错入口

完整的构思、判定标准和技术路线见 [docs/DESIGN.md](docs/DESIGN.md)。

## 本地运行

需要 Node.js 18+。

```bash
npm install
npm test          # 数据校验 + 搜索逻辑测试
npm run build     # 生成静态站点到 dist/
npm run serve     # 本地预览
npm run check-links   # 巡检所有官网是否可访问
```

## 目录结构

```
data/
  categories.yaml     分类
  sites/<分类>.yaml   各分类的官网数据
scripts/
  lib/data.js         读取、校验、生成搜索索引（含拼音）
  validate.js         数据校验
  build.js            生成静态站点
  check-links.js      官网巡检
src/
  search.js           搜索与网址鉴别（纯函数，浏览器与测试共用）
  app.js              页面交互
  style.css
test/                 单元测试
```

## 参与贡献

- **推荐官网 / 纠错**：[提交 Issue](../../issues/new/choose)，请附上官方依据（如 ICP 备案主体）。
- **直接修改数据**：编辑 `data/sites/` 下对应的 YAML，提交 PR，CI 会自动校验。

收录标准：只收官方网站本身，不收下载站、代理商、聚合导航页；网址填首页，不带推广参数。

## 部署

推送到 `main` 后，GitHub Actions 会自动构建并发布到 GitHub Pages（需在仓库设置中将 Pages 来源设为 GitHub Actions）。
在仓库变量中设置 `SITE_URL` 为正式域名，用于生成 sitemap 与 canonical。
面向国内用户正式上线时，建议备案后部署到境内 CDN / 对象存储。
