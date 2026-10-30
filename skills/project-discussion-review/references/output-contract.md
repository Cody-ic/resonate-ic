# 项目讨论输出协议

只输出本次任务的一个 JSON 对象，不加 Markdown 围栏。输入中的 `task` 决定使用哪一种结果，不能用“通过”同时表示帖子通过和举报成立。

共用字段：`summary` 为简短中文结论；`findings` 每项含 `rule`（`spam` / `privacy` / `abuse` / `vulgarity` / `ownership` / `unfounded_demand`）、`quote`（指定目标的原文短引）、`explanation`（问题及处理理由）。`vulgarity` 表示无语境、无实质交流内容的粗鄙纯谩骂，不要求存在具体攻击对象，不能编造受害者或技术背景。`unfounded_demand` 表示向免费作品作者提出无交易依据的退款、索赔或复用成本报销要求，不混为辱骂。需要人工核对时说明具体事实。引用和解释不能完整回显凭据、敏感信息或举报者身份；不声称已经发布、下架或发送通知。

## task = publish

```json
{"task":"publish","decision":"pass","summary":"讨论审核通过。","findings":[],"technicalIssues":[],"commenterNotice":null}
```

`decision` 为 `pass` / `revise` / `disputed`。通过时 `findings` 为空；其他决定须有目标原文依据。

`commenterNotice`：`revise`、`disputed` 时必须为含 `title`、`body` 的对象，接收者为评论发布者，供站内通知和邮件共用。前者说明不通过原因与必要修改，后者说明暂缓发布及待核对事项；`pass` 时为 `null`。是否公开与技术问题是否属实分别表述，不把修改语气当作确认故障的前提，也不声称已经发送或执行转交。

`revise` 表示当前内容被直接拒绝发布、修改后可重新送审。明确的定向辱骂使用此结果，不能降为“通过但建议文明用语”，也不因技术诉求合理而转人工或放行。

发布及举报结果增加 `technicalIssues` 数组，默认 `[]`。每项含 `claim`（中性的待核查技术主张）、`quote`（原文中对应的技术描述短引，不包含辱骂）、`providedEvidence`（本次提供的版本、日志等线索数组）、`missingEvidence`（核查所缺的关键信息数组）。所缺信息不构成留言不予发布的理由。此字段与发布决定、举报是否需要下架独立，不表示问题已经证实。

`pass` 也允许且应当按实际内容输出非空 `technicalIssues`，不需要等技术核查结束才发布。发布审核结果中的 `commenterNotice:null` 只表示这一阶段无不通过/暂缓通知，不影响项目 AI 随后向评论发布者生成技术追问。

```json
{"task":"publish","decision":"pass","summary":"讨论审核通过，所反馈的编译问题待单独核查。","findings":[],"technicalIssues":[{"claim":"反馈该项目在评论者的环境中编译失败，尚未核实原因。","quote":"这份工程在我这编译失败了","providedEvidence":[],"missingEvidence":["完整编译报错日志","评论者使用的构建环境"]}],"commenterNotice":null}
```

```json
{"task":"publish","decision":"revise","summary":"当前内容不予发布。请移除针对作者的辱骂，可保留编译失败反馈；技术问题待项目审核核查。","findings":[{"rule":"abuse","quote":"你TM","explanation":"针对发布者的定向辱骂。"}],"technicalIssues":[{"claim":"反馈该项目代码无法编译，尚未核实。","quote":"不能编译的代码","providedEvidence":[],"missingEvidence":["对应工程版本","编译环境及构建命令","完整编译报错日志"]}],"commenterNotice":{"title":"评论未通过审核","body":"你的评论包含针对作品作者的辱骂，当前不予发布。请移除辱骂后重新提交，可以保留代码无法编译的反馈。技术问题是否属实需单独核查，本次未通过不表示你的故障反馈已被否定。"}}
```

社区已确定的不通过样例：

```json
{"task":"publish","decision":"revise","summary":"当前内容不予发布。请移除针对他人的辱骂和无交易依据的退款要求，可保留故障反馈与技术质疑。","findings":[{"rule":"abuse","quote":"rnm","explanation":"结合直接向对方反馈设计问题的语境，此处是针对对方及其亲属的辱骂，不属于允许的普通情绪表达。"},{"rule":"unfounded_demand","quote":"退钱","explanation":"本场景为免费分享作品，未提供付费交易依据，不能将自行复用的费用以退款要求转嫁给作者。"}],"technicalIssues":[{"claim":"反馈依照项目设计制作的板无法使用，具体故障尚不明确。","quote":"照你的设计打了板但不能用","providedEvidence":[],"missingEvidence":["所用工程版本","具体故障现象及操作步骤"]}],"commenterNotice":{"title":"评论未通过审核","body":"你的评论包含针对他人的辱骂，以及未提供付费交易依据的退款要求，当前不予发布。请移除这些内容后重新提交；可以保留板子无法使用的具体故障反馈。"}}
```

## task = report

```json
{"task":"report","decision":"keep","issueConfirmed":true,"removalNecessary":false,"summary":"举报指出的说明遗漏存在，但不构成下架理由。","findings":[]}
```

- `decision`：`keep` / `take_down` / `disputed`。
- `issueConfirmed`：举报所述问题存在为 `true`，不存在为 `false`，确需人工核对为 `null`。
- `removalNecessary`：确实需要下架为 `true`，不需要为 `false`，确需人工核对为 `null`。
- `take_down` 只能在两个字段都为 `true` 时使用，并在 `findings` 中给出下架证据。
- `keep` 时 `removalNecessary` 为 `false`；小问题确实存在也不等于要下架，可在 `summary` 中简要说明，`findings` 留空。
- `disputed` 至少有一项为 `null`，并给出具体争议依据。单纯缺乏支持举报的证据，不自动转人工。

## task = quality

```json
{"task":"quality","decision":"qualify","summary":"讨论包含具体的调试问题和有参考价值的排查过程。","findings":[]}
```

`decision` 为 `qualify` / `not_qualify` / `disputed`。`qualify` 时 `findings` 为空。`not_qualify` 时，`summary` 说明具体依据；属于内容风险时附 `findings`，仅空泛占位等价值核验问题不强行归为违规。`disputed` 须提供具体争议依据。

## 严重风险与范围规则字段

findings.rule 增加 illegal、severe_safety、off_topic_politics、circumvention、irrelevant。每项可附 legalBasis 标识数组；illegal 必须非空，circumvention 必须包含 international-channel，其他无适用法条时为空。仅从 legalBases 选择实际适用项，不自行补写法规名、条号、定罪或处罚，系统将法条与官方链接补入站内及邮箱共用文案。off_topic_politics 和 irrelevant 是社区范围规则，不附法律定性。

明确问题返回 revise；存在具体严重疑点而需核对时，disputed 配合 illegal/severe_safety/circumvention 表示当前版本暂缓公开，由服务端执行，不能写成先发布。普通归属等争议仍沿用原处理方式。简短纯夸赞可通过，普通技术延伸不按无关处理。
