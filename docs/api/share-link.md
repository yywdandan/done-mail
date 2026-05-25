# 共享接口

共享接口用于创建共享邮件或共享账户。

共享入口默认跟随后台入口。后台入口为任意时，会使用当前请求的入口生成共享地址。也可以在系统设置中指定独立共享入口。

```http
POST /api/shares
X-Admin-Key: your-admin-key
Content-Type: application/json
```

## 请求体

共享邮件：

```json
{
  "type": "mail",
  "mailId": "mail_abc123",
  "ttlHours": 168
}
```

共享账户：

```json
{
  "type": "account",
  "mailbox": "user@example.com",
  "ttlHours": null
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | string | 是 | `mail` 或 `account` |
| `mailId` | string | 共享邮件必填 | 邮件 ID |
| `mailbox` | string | 共享账户必填 | 要共享的实际收件邮箱 |
| `ttlHours` | number/null | 否 | 有效期小时数，默认 168；传 `null` 表示永久 |

## 成功返回

```json
{
  "ok": true,
  "data": {
    "id": "share_abc123",
    "type": "account",
    "token": "account_abc123",
    "mailId": "",
    "mailbox": "user@example.com",
    "url": "https://share.example.com/account/account_abc123",
    "expiresAt": null,
    "createdAt": "2026-05-21T10:00:00.000Z",
    "updatedAt": "2026-05-21T10:00:00.000Z"
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 共享记录 ID |
| `type` | string | `mail` 或 `account` |
| `token` | string | 共享 Key |
| `mailId` | string | 共享邮件 ID，共享账户为空 |
| `mailbox` | string | 共享账户邮箱，共享邮件为空 |
| `url` | string | 可直接打开的共享地址 |
| `expiresAt` | string/null | 过期时间；`null` 表示永久 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 更新时间 |

同一封邮件或同一个邮箱账户重复创建时，会刷新有效期，不会重置 Key。需要重置 Key 请在后台共享列表中操作。

## 失败返回

```json
{
  "ok": false,
  "error": {
    "code": "share_create_failed",
    "message": "邮件不存在"
  }
}
```

| 状态码 | code | 典型原因 |
| --- | --- | --- |
| `400` | `share_create_failed` | 邮件不存在、邮箱格式不正确或有效期不合法 |

## 限流说明

创建共享属于公开 API，鉴权成功不计入限流。

`/mail/:token` 和 `/account/:token` 是公开页面入口，只返回前端页面，不消耗共享访问限流。

共享访问限流只作用于：

| 路径 | 说明 |
| --- | --- |
| `/api/shared/mails/:token` | 读取共享邮件详情 |
| `/mail/:token/attachments/:attachmentId` | 下载共享邮件附件 |
| `/api/shared/accounts/:token/*` | 读取共享账户邮件 |

共享访问默认限流为每小时 `500` 次。

共享邮件页默认不加载远程图片，访问者可以在页面中手动显示。

## 共享访问接口

共享页面内部会调用这些接口。返回内容只保留公开访问需要的字段，不返回 `messageId`、`domain`、`headers`、`rawSize` 和 `createdAt`。

### 读取共享邮件

```http
GET /api/shared/mails/:token
```

```json
{
  "ok": true,
  "data": {
    "id": "mail_abc123",
    "fromAddr": "sender@example.com",
    "fromName": "Sender",
    "toAddr": "user@example.com",
    "subject": "Hello",
    "bodyPreview": "正文摘要",
    "hasAttachments": true,
    "attachmentCount": 1,
    "receivedAt": "2026-05-21T10:00:00.000Z",
    "textBody": "正文",
    "htmlBody": "",
    "attachments": [
      {
        "id": "att_abc123",
        "filename": "file.pdf",
        "mimeType": "application/pdf",
        "size": 1024,
        "stored": true
      }
    ]
  }
}
```

### 读取共享账户邮件列表

```http
GET /api/shared/accounts/:token/mails?per_page=20&cursor=&keyword=
```

```json
{
  "ok": true,
  "data": {
    "account": {
      "mailbox": "user@example.com"
    },
    "items": [
      {
        "id": "mail_abc123",
        "fromAddr": "sender@example.com",
        "fromName": "Sender",
        "toAddr": "user@example.com",
        "subject": "Hello",
        "bodyPreview": "正文摘要",
        "hasAttachments": true,
        "attachmentCount": 1,
        "receivedAt": "2026-05-21T10:00:00.000Z"
      }
    ]
  },
  "pagination": {
    "limit": 20,
    "nextCursor": "",
    "hasMore": false
  }
}
```

### 读取共享账户内单封邮件

```http
GET /api/shared/accounts/:token/mails/:id
```

返回字段与 `GET /api/shared/mails/:token` 相同。
