# 官网收录

查询官网与具体官方入口，并查看来源依据、核对方式和复核日期。无广告、无竞价排名。

当前保留 62 条产品候选。2026-09-30 完成 Python、Node.js、Git、Visual Studio Code、7-Zip 共 5 个产品、14 个入口的公开来源辅助核对；其余 57 条为待审核记录。**辅助核对不是人工复核，页面会明确标注方法与记录者。**

## 能做什么

- 按名称、别名、拼音或首字母查找；`Node.js` 优先识别为产品名称。
- 搜索 `Python 下载`、`VS Code 文档` 时优先提供对应入口。
- 默认只显示复核期内、具有来源依据的记录；勾选后可查看候选资料。
- 粘贴网址，只比对完整主机名。不会将父域名下所有子域名自动标为官方，也不因名称相似判定仿冒。
- 详情页展示主体、各入口、对应来源、核对方式与时间；待审核和过期记录暂停直达。
- 定期检测已登记入口，记录连续失败、重定向链和节点信息；可启用去重后的 Issue 提醒。

主机名匹配不验证任意路径、当前网页、下载文件或交易安全；使用详情页列出的具体入口。搜索输入不写入 URL 或历史记录。

## 本地运行

使用 Node.js 22 或更高版本。

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run serve
npm run check-links
```

`npm run serve` 使用 npm 的 `serve` 工具预览。未设置 `SITE_URL` 时构建为本地预览，不生成 canonical 或 sitemap，并设置 noindex。

## 贡献记录

[提交收录或纠错](https://github.com/bocmiao/official-site-directory/issues/new/choose)需要 GitHub 账号，也可直接修改 `data/sites/*.yaml` 提交 PR。

候选标为 `pending`；只有逐一核对来源后，才填写核验字段和 `entries`、`evidence` 并设为 `verified`。结构校验不替代维护者对来源真实性的审阅。数据规范及维护步骤见 [设计与维护说明](docs/DESIGN.md)。

代码与数据已公开，但本仓库尚未选择许可证；公开可读不代表已经授予复用许可。

## CI 与发布

CI 在所有分支推送和 PR 时运行测试、构建，不再依赖分支必须叫 `main`。当前默认分支名由 GitHub 自动读取。

启用 GitHub Pages 时：

1. 在仓库设置中将 Pages 的来源设为 GitHub Actions。
2. 设置仓库变量 `SITE_URL` 为完整正式站点地址。项目站需要包含仓库路径，例如 `https://bocmiao.github.io/official-site-directory`。
3. 设置仓库变量 `ENABLE_PAGES=true`。
4. 在默认分支推送或手动运行 CI；发布构建会拒绝缺失、示例域名或非 HTTPS 的 `SITE_URL`。

只有默认分支可部署。每日构建用于刷新过期状态；未启用 Pages 时只执行检查，不发布。PR 分支仅供审阅，不自动改变线上站点。

## 巡检

每周巡检，也可以手动运行“官网巡检”。`.monitor/` 保存本地状态和报告，不提交到 Git；Actions 使用缓存保存连续失败记录，并上传 `monitor-report` artifact。

- 单次网络错误只记录；同一入口、同一节点连续两次失败进入复核。
- 未登记主机名、HTTPS 降级或不安全重定向立即进入复核；不会继续请求未知跳转目标。
- 过期核验进入复核队列，连接成功不会延长核验有效期。
- 请求只读取响应头，检查并固定公开 DNS 地址，限制超时与跳转次数。
- 可设置 `ENABLE_MONITOR_ISSUES=true` 开启一个汇总 Issue，仅异常集合有变化时更新，恢复后关闭。未启用时报告仍可在 Actions 查看。

GitHub 托管节点的位置不固定；连接失败不能直接解释为国内用户不可访问。缓存被清理会重置连续失败计数，报告 artifact 保留 90 天。定时工作流不是实时监控，维护者仍需定期查看最近一次运行结果。

若本地代理把域名解析为 `198.18.0.0/15` 等保留地址，检测器会报告 `UNSAFE_ADDRESS` 并停止请求。这表明该环境无法直接巡检，不代表目标网站失效；请在正常解析公网地址的节点运行，不要关闭地址检查。

## 文件结构

```text
data/sites/          产品候选、核验记录与入口
scripts/lib/data.js  数据加载、结构校验和搜索索引
scripts/lib/probe.js 安全请求、重定向与连续失败规则
scripts/build.js     静态页面与发布输出
scripts/check-links.js 巡检报告与历史状态
src/search.js        搜索分流、入口用途与主机名匹配
src/app.js           搜索交互与失败重试
test/                数据、搜索、巡检与构建回归测试
```
