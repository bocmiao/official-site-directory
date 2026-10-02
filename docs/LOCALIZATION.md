# 中文名称与教育目录拆分

原“教育考试”包含 18,926 条记录，来自国内教育考试服务 5 条、Hipo 高校 1,091 条及 ROR 机构 17,830 条。批量数据偏向全球院校，不能把这一数量当作国内考试官网数量。

现分为：教育考试服务 5 条、内地院校与机构 1,785 条、港澳台院校与机构 92 条、海外院校与机构 17,044 条。只是重新组织记录，不删除资料、不更改 ID，也不改变核验结论。`data/categories.yaml` 定义 12 个一级分类，加载时根据原始来源与地区映射机构分类。原 `category/education/1.html` 现在仅浏览考试服务。

网页默认展示全部可见记录，先显示已核对入口，再显示人工整理的国内常用服务，之后是软件和各区域机构。所有未核验记录继续显示状态，仍不提供官网直达按钮。底层 `queryCatalog` API 的默认范围保持 `catalog`，页面显式传入 `all`，避免其他调用方意外扩大信任范围。

## 中文展示规则

1. 优先使用来源本来就提供的中文名。语言代码为 zh 的罗马字拼音不当作中文名。
2. 使用 ROR 自带 Wikidata 标识关联中文标签，优先简体变体。保存条目 ID、版本号与原名；详情提供固定版本链接。Wikidata 是社区维护来源，不保证名称是机构正式中文名。
3. 无上述中文名时，使用 `editorial.json` 中的参考译名，再使用本地机器翻译结果。机器译名统一标“待校对”，不等于逐条人工确认。
4. 纯缩写、没有中文输出或明显异常的机器结果保留原名，标注专名待补充。不能为了中文覆盖率猜测简称全称。

批量翻译使用 Helsinki-NLP 的 `opus-mt-en-zh`，CTranslate2 4.8.2 与 SentencePiece 0.2.2，本地运行；先选择 ROR 明确标注的英文名称，缺失时使用登记原名。非英文专名、音译和小众机构仍可能译错，原名始终同时保留。已纠正抽查中发现的重复词、地名、人名与常见院校译名，但不能声称全部译名准确。

原始 `name` 不覆盖。`localization` 记录 `original_name/name_zh/method/source_record`，机器记录保留输入，Wikidata 名称保留版本。名称或来源记录变化会使校验失败，防止错误沿用旧译名。原名、译名、原别名及中文拼音都可以搜索；译名不改变网址匹配、核验到期或直达入口规则。

## 更新和复现

`scripts/import-localization.js <缓存目录>` 从缓存合成 `data/localization/zh-CN.json`。缓存需包含：`source-names.json`、`wikidata-mapping.json`、`wikidata-labels.json`、`translated-ct2.jsonl`。字段检查、记录覆盖与全目录校验通过后才写入。提交的清单保存模型版本、译文摘要和 Wikidata 快照摘要；完整模型和原始缓存不随网站分发。

`data/localization/editorial.json` 以原名或翻译输入为键，保存维护者参考译名。修改后重新导入并执行 `npm test`、`npm run audit:data`。已存在的来源中文名和 Wikidata 名称优先级更高；源名称有误时应针对原始来源或具体记录修订，不能静默替换来源身份。

Wikidata 结构化中文标签使用 [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing)。翻译模型信息见 [Helsinki-NLP 模型卡](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh)，原模型许可为 Apache-2.0。网页数据下载包含中文名称及逐条来源，原有 ROR、Hipo、Homebrew 与 GeoNames 的许可和归属说明继续保留。

## v0.8 分类扩充的中文名称

新增维基数据批次的中文名保存在 `data/imported/directory.json` 的 localization 字段，避免覆盖原有院校译名。5,869 条来源中文名、5,565 条机器参考译名、397 条专名保留原文。机器翻译设置和输出摘要见 `data/localization/directory-model.json`，使用同一冻结版本的本地模型。`scripts/localize-directory.js <translated.jsonl>` 校验 ID、原名和来源 ID 后写入；英文原名保留。网站导出合并两批中文字段。
