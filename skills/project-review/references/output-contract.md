# 作品审核输出协议

输出单个 JSON 对象，不附 Markdown 围栏或其他文字。

```json
{"decision":"pass","summary":"恭喜，作品审核通过。","findings":[],"improvements":[],"taxonomy":{"tags":[],"platforms":[],"sources":[]},"authorNotice":{"title":"作品审核通过","body":"恭喜，你的作品通过本次审核，感谢分享！"}}
```

- `decision`：`pass` / `revise` / `disputed`。
- kind=resource 时必须输出 resourceReliability，按开发资源可靠性审核的独立尺度判断；可靠性未达标不能仅因无违规就通过，争议资源先不公开。findings 的 rule 额外允许 reliability，仅用于资源关键可靠性问题。
- `summary`：简短中文结果。通过且无问题时简短祝贺即可；退修说明拦截原因；争议说明作品可先发布、待核对事项由人工复核。不能声称作品已公开、通知已发送或操作已执行。
- `findings`：只列阻止发布的问题。每项含 `rule`（`spam` / `privacy` / `abuse` / `vulgarity` / `ownership`）、`quote`（目标原文短引）、`explanation`（具体问题和处理办法）。`vulgarity` 表示不必指向具体个人的明显粗鄙谩骂，不虚构攻击对象；普通调试感叹不使用此项。通过时为空，其他决定须有原文依据。
- `improvements`：默认 `[]`。达到建议门槛时，每项含 `field`（涉及的投稿字段或章节）、`basis`（可定位的已有事实或缺失依据）、`impact`（对使用的具体影响）、`action`（作者可执行的改进）。非阻断的完善建议不放进 `findings`。
- `taxonomy`：只列需要处理的分类项；以下数组可为空或省略。保留原名称时通常无需输出条目。
- `authorNotice`：普通投稿审核三种决定均必填，为含 `title`、`body` 的顶层对象，不得只返回 `summary`、遗漏或与其他字段相互嵌套。同一份文案供站内通知与邮件共用；收件人是作品发布者，不是评论者。通过时简短祝贺，有非阻断建议时明确“可选”；未通过时说明必要修改与可重新送审；待人工核对时说明“作品先发布，待人工复核”及具体疑点，不预判违规、不写成暂缓发布。合并、剔除标签/平台或来源调整时，正文单列分类处理及具体理由，不能只藏在 `taxonomy` 里。未经执行记录支持，不声称已经发送、公开或完成分类更改。

正文举例（不是另一次审核结果）：

```json
{"title":"作品暂未通过审核","body":"本次在 Core/Src/main.c 中发现与项目无关的促销引流字符串及一处粗鄙谩骂注释，请移除或改写后重新提交。正常调试感叹无需删除。分类处理：所填 CH 与 STM32 工程不符，本次分类方案将 CH 替换为 ST。屏幕显示标签可保留。可选完善建议：说明默认自检模式与界面演示模式的切换方式，此项不影响审核决定。"}
```

## 标签和平台

`tags`、`platforms` 每项含作者原名 `label`、`action`（`allow` / `merge` / `reject`）。合并时提供当前词表中同种类的已有目标 `target`；剔除时提供 `rule`（`spam` / `abuse` / `privacy` / `irrelevant`）和具体 `reason`。实际修正的条目均须说明理由。

`platforms` 额外允许 `action:replace`，同时填写原平台 `label`、词表中已有的正确平台 `target` 和具体工程依据 `reason`；执行语义为移除错选项并补入正确项，结果去重。它不是 `merge` 的别名，不能在普通技术标签中用此操作凭空添加标签。明确错选且目标确定时直接输出替换方案，不只剔除后要求作者自己补填，也不因此退稿。

```json
{"label":"CH","action":"replace","target":"ST","reason":"工程配置与源码标明使用 STM32F103RCT6，属于已有 ST 平台，未见 CH 芯片；纠正错选项。"}
```

```json
{"label":"加群领券","action":"reject","rule":"spam","reason":"这是与作品技术内容无关的优惠券推广"}
```

## 来源和二级类

`sources` 每项含从0开始的投稿数组索引 `index`、处理后来源 `name`、二级类 `division`（可为空）、归类理由 `reason`。批准作者的 `proposedName` 时填 `createSource:true`，批准 `proposedDivision` 时填 `createDivision:true`；使用已有项时省略创建标记。已有二级类须属于所选来源。

```json
{"index":0,"name":"电赛","division":"控制类","reason":"作者明确说明工程来自电赛控制题"}
```

标签调整不能夹带正文修改，不在这些字段中添加未提交的新标签。引文和说明中不得完整回显密钥或敏感个人资料。

## 可选的精选申请邀请

## 可选的完整组件草稿

按 [完整组件草稿协议](resource-draft.md) 输出。

## 开发资源的独立规则

kind=resource 时，authorNotice 与决定采用 resource-review.md 的范围和证据规则，覆盖本协议中普通作品“争议先发布”的表述。检查未完成暂不公开，不能写成已发布或认定不合格。resourceReliability 必须给出 checkedScope；可靠性打回使用 confirmedIssues 提供实际文件、引文、依据、已确认前提及实质影响。未实测或未读完其他材料本身不是明确缺陷。

## 精选申请邀请格式

`featuredInvitation` 默认 `null`。明显有精选潜力的普通项目通过时，可输出：
```json
{"criteria":["teaching"],"quote":"本次实际读到的项目原文","reason":"指出有潜力的具体成果，邀请作者自行申请，不承诺入选"}
```
criteria仅能包含competition/teaching/depth/creativity，quote须有实际原文支持。通知中邀请作者在作品详情“申请精选评估”，并说明后续还需独立评估；不得声称已精选。

