# 审核输出协议

返回单个 JSON 对象，不加 Markdown 围栏或额外文字。必要字段为 `decision`、`summary`、`findings`；没有分类调整可省略 `taxonomy`。

```json
{"decision":"pass","summary":"说明清楚，允许以进行中项目发布；新标签予以保留。","findings":[]}
```

- `decision`：`pass` / `revise` / `disputed`。
- `summary`：简短中文结论。
- `findings`：通过时为 `[]`；否则每项含 `rule`（`spam` / `privacy` / `abuse` / `claims` / `missing` / `ownership`）、`quote`（原文短引）、`explanation`（理由和修改建议）。
- `taxonomy`：可含 `tags`、`platforms`、`sources` 数组，仅列需要处理的项。

### taxonomy.tags / taxonomy.platforms

每项含原名 `label`、处理 `action`（`allow` / `merge` / `reject`）。保留可省略；合并提供已有目标 `target`；剔除提供 `rule`（`spam` / `abuse` / `privacy` / `irrelevant`）和具体 `reason`。

### taxonomy.sources

每项含从0开始的 `index`、来源 `name`、二级类 `division`（可为空）、归类理由 `reason`。使用已有项时省略创建标记；批准作者 `proposedName` 时填 `createSource:true`，批准 `proposedDivision` 时填 `createDivision:true`。不调整则省略该项。

```json
{"decision":"pass","summary":"可发布，来源按说明归入电赛控制类。","findings":[],"taxonomy":{"sources":[{"index":0,"name":"电赛","division":"控制类","reason":"作者说明作品源于电赛控制题"}]}}
```

