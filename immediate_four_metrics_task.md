立即执行一次**仅采集与回写四项排名指标**的完整任务，不同步 Listing、不重建关键词、不更新评论或库存。

工作目录：`/home/ubuntu/amazon-incense-rank-dashboard`。目标文件：`private_spapi_import/rank_targets.json`。这个文件当前包含 42 个有效 FBA Listing 的 370 个严格核心词；以该文件为唯一目标集合。

对每个 `marketplace + ASIN`，使用已连接的 Sorftime MCP `product_traffic_terms`，以正确的 `amz_site=US|CA|JP` 读取第 1、2、3 页。对返回词和目标词使用 Unicode NFKC、trim、lowercase 后精确匹配；只使用 `latest_organic_position`。将 `Page X, Pos Y/Z` 解析为 `naturalRank=(X-1)*Z+Y`、`page=X`；无匹配的真实结果写 `naturalRank=999,page=4`。严禁使用广告位替代自然位。

对每个目标关键词，调用 DataForSEO MCP `merchant_amazon_products_live_advanced`：US 使用 `location_name=United States, language_code=en_US`；CA 使用 `location_name=Canada, language_code=en_CA`；JP 使用 `location_name=Japan, language_code=ja_JP`。仅采用这一次调用返回的 `items`。目标 ASIN 必须精确匹配 `data_asin`。

PC 广告位：仅 `type=amazon_paid` 的精确 ASIN 结果有效。URL 包含 `sbv_search` 或 `sponsored brands video` 的结果计为 SBV，取最小 `rank_absolute` 写 `pcSbvRank`；其他 paid 结果取最小 `rank_absolute` 写 `pcAdRank`。已返回结果中未找到某类广告，则该字段写 999；不得写推测值。

CPR（8天估算）：仅使用同一关键词的 `type=amazon_serp`、`rank_absolute` 处于 21–30、且 `bought_past_month` 是非负数的有机商品。若样本数至少 5：`monthlySalesAverage=四舍五入平均值`，`cprEstimate=max(1,四舍五入(monthlySalesAverage/30*8))`。样本不足 5 时，`cprEstimate` 与 `monthlySalesAverage` 必须是 null，保留真实 `cprSampleCount`。

每个 Listing 只有当其全部关键词均完成上述记录、无重复时，才写 `private_spapi_import/four_metrics/{marketplace}-{asin}.json`，格式：
`{marketplace,asin,results:[{marketplace,asin,keyword,naturalRank,page,pcAdRank,pcSbvRank,cprEstimate,monthlySalesAverage,cprSampleCount}]}`。

如果任何必需工具调用失败、结果缺失、ASIN 不匹配、重复、或数量核对失败，停止整批：不得运行导入器，不得写入部分数据库。只有 42 个文件齐全，且合计 370 个唯一键全部匹配 `rank_targets.json` 时，运行：
`cd /home/ubuntu/amazon-incense-rank-dashboard && npx tsx scripts_import_live_four_metrics.ts`

核对输出：`rank.updated=370`、`cpr.updated=370`、`ads.updated=370`。报告自然位 Top10/Top50/前三页外、CPR 已计算/样本不足、PC广告命中、SBV命中、以及 US/CA/JP 分站计数。禁止随机数、模拟、跨站点复用、广告报表替代自然位、或将采集失败伪装成 999。
