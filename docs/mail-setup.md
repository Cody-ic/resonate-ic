# Outlook 发信接入

网站使用 Microsoft Graph 的委托授权发送验证码和通知。真实凭据只放在服务端环境和加密的本地数据库中，不上传 GitHub。

## 首次授权

1. 在 Microsoft Entra 的应用注册中创建应用，账号类型选个人 Microsoft 账号。
2. 添加公共客户端/本机回调：`http://localhost:53682/oauth/callback`。此回调仅用于维护者在本机完成首次授权，不是网站用户的登录入口，不需要网站先上线。
3. 在网站目录中先配置被 Git 忽略的 `.dev.vars` 和既有 `BETTER_AUTH_SECRET`，然后运行：

   ```sh
   node scripts/authorize-outlook.mjs --client-id <应用客户端ID> --mailbox <发件邮箱>
   ```

4. 打开 `.sites-runtime/mail-authorization/status.json` 中的授权网址，登录并确认权限。仅申请 `Mail.Send`、`User.Read` 和 `offline_access`，不申请读取收件箱。`User.Read` 用于首次核对账号身份，正常发信刷新令牌只请求发信权限。
5. 若发件地址是微软账号别名，而 Graph 返回外部主要用户名，先在微软“管理登录帐户的方式”页面核对两者属于同一账号，再给命令补充 `--verified-primary-account <已核对的主要用户名>`。不要仅凭相似昵称跳过身份核对，也无需更改主要用户名。

授权助手使用随机 state 与 PKCE，验证授权账号后原子写入 `.dev.vars`。初始为 `test` 模式，仅向发件邮箱自己发送。原配置备份在被忽略的 `.sites-runtime/mail-authorization/`。助手不输出访问令牌、刷新令牌或验证码；成功后跳转到不带授权码的提示页，并保留两分钟以处理页面刷新。

## 验证与启用

配置改变后重启本地服务。管理员工作台 → 审核工具与运行状态 → 邮件投递，可向发件邮箱发送测试邮件。每分钟最多一封，普通用户不能调用，收件人由服务端配置确定。

需要核对三件事：队列记录变成 `accepted`、实际收到邮件、实际发件地址正确。`accepted` 仅表示微软接受请求，不能据此宣称已送达。检查收件箱及垃圾邮件夹。

管理员也可调用 `POST /api/admin/mail/test`，JSON 为 `{"target":"administrator"}`，向 `ADMIN_EMAILS` 中配置的地址发送连接测试。此入口不接受任意收件地址；联调模式仍受精确收件人名单限制。

确认后在本地或生产环境分别配置：

```dotenv
MAIL_PROVIDER=graph
MAIL_FROM=<已验证的发件地址或同账号别名>
MAIL_FROM_NAME=共振
MAIL_GRAPH_CLIENT_ID=<应用客户端ID>
MAIL_GRAPH_REFRESH_TOKEN=<授权助手保存的刷新令牌>
MAIL_DELIVERY_MODE=live
MAIL_REQUIRE_EMAIL_VERIFICATION=true
ADMIN_EMAILS=<管理员收件邮箱，多个用逗号分隔>
```

启用邮件发送和要求验证后登录是两个独立设置。后者开启后，已有未验证账号可以从 `/verify-email` 补验证。普通通知只发往已验证的账号邮箱；管理员提醒按 `ADMIN_EMAILS` 发送；评论下的回复仍仅站内通知。

`MAIL_FROM_NAME` 指定发给 Graph 的显示名称，默认“共振”。须核对实际收件的邮件头，不能仅凭配置断言个人 Outlook 会采用该名称。修改微软账号本身的姓名可能影响同账号的其他微软服务，不由这个配置自动执行。

若微软返回 `ErrorAccountSuspend`，网站会暂停该提供方的发送，并提示邮箱持有人按微软收件箱通知完成账号验证；不将其误报为 OAuth 授权失效，不自动重试。暂停期间注册和验证码接口会明确说明邮件服务需要维护。完成验证后，管理员在邮件投递区域点击“已完成微软验证，恢复发信”，明确确认后恢复后续任务；此前发送失败的邮件仍需单独核对并处理。

## 部署和维护

- GitHub 源码没有运行凭据。部署时通过服务器私有环境变量或托管平台的 secret 配置这些值，并独立迁移数据库；公开仓库不能替代运行数据备份。
- `BETTER_AUTH_SECRET` 同时用于邮件令牌及验证码正文的静态加密，不可直接换成另一个值后继续使用旧加密数据。
- 工作进程会保存轮换后的刷新令牌，再发送邮件。授权失效在管理员工作台提示重新授权；不把供应商返回的凭据写进通知。
- 不确定是否已发送的邮件不自动重发；管理员核对发件箱后再决定重试。
- SMTP、收件读取和用户 Microsoft 登录不是本接入的功能。

官方接口说明：[Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)、[OAuth 授权码与 PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)。
