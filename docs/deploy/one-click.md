# 一键部署

推荐使用 Cloudflare Deploy Button 一键完成 DoneMail 部署。

## 应用部署

### 1. 点击一键部署

从 DoneMail 仓库或 README 点击 <a class="dm-deploy-button" href="https://deploy.workers.cloudflare.com/?url=https://github.com/lchily/done-mail" target="_blank" rel="noreferrer">Deploy to Cloudflare</a>。

![README 中的 Deploy to Cloudflare 按钮](/deploy/readme-deploy-button.png)

### 2. 选择部署模式

选择 Git 账号后，在部署配置页选择一种模式：

| 模式 | Build command | Deploy command | 附件能力 |
| --- | --- | --- | --- |
| 轻量部署 | `npm run build` | `npm run deploy` | 保存附件元信息，不保存附件内容 |
| 完整部署 | `npm run build` | `npm run deploy:r2` | 额外绑定 R2，可保存和下载附件内容 |

#### 轻量部署：无需 R2

保持默认命令：

| 资源 | 绑定名 | 说明 |
| --- | --- | --- |
| KV | `KV` | 保存系统配置和管理员 Key |
| D1 | `DB` | 保存邮件、发信记录、域名、日志和限流计数 |

没有 R2 时，DoneMail 会保存附件元信息，但不保存附件内容，也不能下载附件文件。

#### 完整部署：启用 R2 附件保存

如果需要保存和下载附件内容，把部署页里的 Deploy command 改成 `npm run deploy:r2`。

完整部署会额外创建并绑定 R2 Bucket：

| 资源 | 绑定名 | 说明 |
| --- | --- | --- |
| R2 | `MAIL_BUCKET` | 保存和下载附件内容 |

![Cloudflare 部署配置页面](/deploy/cloudflare-deploy-config.png)

### 3. 初始化后台

部署完成后打开 DoneMail 后台，首次进入时创建管理员 Key。

![DoneMail 初始化管理员 Key 页面](/deploy/setup-admin-key.png)

## 后续更新

Cloudflare 会把部署连接到生成的 Git 仓库。

后续更新只需要更新这个仓库的生产分支，Cloudflare 会自动重新构建并部署。
