# 校园网内测部署

本次部署地址为 `https://10.10.60.102:18443/`，仅用于校园网内测。
使用编译后的 Worker、Miniflare/workerd 持久化绑定及独立 Node HTTPS 入口；不运行 Vite 开发服务器。Miniflare 是 Cloudflare 的本地兼容运行环境，本部署不等于 Cloudflare 托管生产环境。

## 目录和服务

- `/home/yys/resonate-ic/runtime/node`：用户目录中的 Node 22 LTS，已核对官方 SHA256。
- `releases/` 与 `current`：版本目录和当前版本软链接。
- `shared/app.env`：私有配置，权限 600；不放进源码包。
- `shared/state/`：D1、R2、Durable Object 和 Workflow 持久化数据。
- `shared/tls/`：内测证书和私钥。证书有效期至 2027-01-27，公钥证书 SHA256 指纹为 `44:29:C8:A9:63:41:DD:B7:0D:B8:0D:0F:57:83:D8:FA:FD:DB:E9:4A:C1:C5:79:7B:2F:B3:9C:E7:49:EF:93:43`。
- `backups/`：AES-256-GCM 加密备份；`shared/backup-key` 为恢复密钥，应另存于安全位置，不能只保留服务器这一份。

服务以 `yys` 用户运行，已开启用户 linger；不修改既有 nginx 或其他人的服务。

```bash
systemctl --user status resonate-campus.service
journalctl --user -u resonate-campus.service -n 50 --no-pager
systemctl --user restart resonate-campus.service
systemctl --user list-timers resonate-campus-backup.timer
```

每分钟唤醒审核和邮件队列；DO/Workflow 持久化和内部并发限制保持有效。入口使用真实 TCP 对端地址，丢弃客户端提交的代理和平台身份头，拒绝内部调试路径与非预期 Host。没有添加未经确认的校园网 CIDR 豁免。

## 数据与账号

数据库从全部 13 份迁移文件初始化，不使用公开静态预览的数据。只迁入维护者已有的密码账号，不迁入登录会话或 `local_seedy` 平台身份。原邮箱验证状态保持不变；用户须通过网站完成正常验证。管理员配置使用真实账号 ID。

不自动搬入、上架旧测试作品。新的投稿走真实审核流程，评论与回复保留原有语境、通知、申诉和权限规则。

邮件授权迁入时重新加密，使用新的内测认证密钥；刷新令牌轮换只在服务器进行。本机邮件与模型调用已暂停。切回本机时，必须先停学校服务，再迁出最新授权和预算，不能直接恢复旧 `.dev.vars` 并让两端同时运行。

原来的预算赠额和 116 条调用记录已经迁入，保留结转及实际占用。历史调用关联到不可执行的 `budget_history` 归档记录，不复制旧评论、作品或模型对话。月度新增额度仍是项目 30 元、讨论 30 元、合计 50 元，旧余额优先使用。

## 备份与恢复

每日北京时间 04:30 左右短暂停服务生成加密备份，完成或失败都会重新启动服务。SQLite 使用一致性快照，不直接拷贝 WAL 中间状态。当前备份不自动清理历史文件。

手动备份：

```bash
bash "$HOME/resonate-ic/current/scripts/campus-backup.sh"
```

恢复到全新的目录并核对哈希和 SQLite 表计数：

```bash
python3 "$HOME/resonate-ic/current/scripts/campus-backup.py" restore \
  --shared "$HOME/resonate-ic/shared" \
  --archive /绝对路径/备份.resbackup \
  --target /绝对路径/尚不存在的恢复目录
```

恢复默认隔离原始凭据、关闭外发，避免演练目录发送邮件或消耗 API。完整切换需明确配置恢复目录和服务，并核验密钥、最新预算、附件读取后再启动。

## 本次验收记录

- 学校服务器构建完成，匿名 8 项冒烟检查通过。
- 首页、精选、课程、资源、隐私及联系页面均返回 200，静态 CSS 可读取。
- 伪造平台身份不能登录；内部调试入口返回 404。
- 200 组各依次读取 3 个接口，共 600 个请求，失败 0；本机到学校的实测整轮约 1.27 秒。此项不代表登录、写入或模型吞吐量。
- 加密备份和新目录恢复核验 11 个文件通过；后台服务重启后原数据可读。
- 服务器发出的维护者邮箱验证邮件已被 Graph 接受，不将接受状态表述为已到达收件箱。
- 学校 Linux 主机运行完整编译 Worker 的 110 项流程验收通过，模型与邮件外部请求全部拦截；没有额外付费调用，也没有改写内测库。

浏览器首次访问需要用户亲自处理证书信任提示。服务器与接口检查不能替代用户完成验证后对登录、投稿及通知页面的实际验收。
