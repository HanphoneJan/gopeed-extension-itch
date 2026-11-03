# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |

## Reporting a vulnerability

请**不要**在公开 issue 中提交以下内容：

- itch.io Cookie 或任何登录凭据；
- CSRF token；
- 完整的签名下载 URL；
- 包含上述内容的 Gopeed 日志或任务数据。

推荐通过 GitHub 的私有安全公告报告：

<https://github.com/HanphoneJan/gopeed-extension-itch/security/advisories/new>

如果无法使用该入口，可以开一个 **不含敏感信息** 的 issue，说明“需要私下联系”，不要贴出凭据。

## 安全边界

- 扩展只处理公开/免费的 itch.io 页面。
- 不绕过登录、购买、年龄确认或隔离检查。
- Cookie 只发送给 `*.itch.io`；探测签名 URL 时不发送。
- 日志会脱敏 URL、Cookie、CSRF 和签名参数。
- Gopeed 会把任务 URL（签名 URL）保存在自己的任务数据库中，这是下载器工作的必要条件；扩展无法删除该字段。

## 依赖

扩展没有运行时依赖；测试只使用 Node.js 内置模块。CI 使用 GitHub Actions 官方 action。
