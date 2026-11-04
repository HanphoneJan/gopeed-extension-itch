# Contributing

感谢你愿意改进 **itch.io Downloader for Gopeed**。

## 项目范围

这个项目只做一件事：把 **公开/免费** 的 itch.io 游戏主页解析成 Gopeed 文件列表，并处理 itch.io 的短时效签名 URL。

不接受：

- 绕过登录、购买、年龄确认或隔离检查的代码；
- 通用站点抓取/下载 fallback；
- 把 Cookie、CSRF token、签名 URL 写入仓库、日志或测试 fixture；
- 提交下载的游戏文件。

## 开发环境

- Node.js 20+（仅测试需要）
- 无 npm 依赖；扩展本身是纯 JavaScript
- 推荐 Gopeed 1.9.3+
- 本地开发者安装、API 兼容性和测试细节见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

```bash
git clone https://github.com/HanphoneJan/gopeed-extension-itch.git
cd gopeed-extension-itch
node --test test/index.test.js
```

## 代码约定

- `index.js` 运行在 Gopeed 的 goja 中，不是浏览器/Node：
  - 不使用 DOM、Node API、第三方运行时依赖；
  - 避免可选链、nullish coalescing 等新语法，保持与 Gopeed 1.9.3 兼容；
  - 网络请求统一走 `fetch`，错误用 `MessageError` 抛给 Gopeed。
- 不记录敏感信息：URL、Cookie、CSRF、签名参数必须经过 `redact`/`safeMessage`。
- 新平台/页面结构请先加 HTML fixture，再改解析逻辑。

## 测试

```bash
node --test test/index.test.js
```

提交前请确保：

- 所有单元测试通过；
- 不访问真实网络（单元测试必须 mock `fetch`）；
- 日志断言仍覆盖 URL/Cookie/CSRF 脱敏。

真实 Gopeed 冒烟测试需要单独启动 Gopeed，见 README 的 “Gopeed 真实接口测试”。

## 提交 Pull Request

1. Fork 仓库并从 `main` 创建分支。
2. 保持改动聚焦，一个 PR 解决一个问题。
3. 更新 README（中英）与 CHANGELOG（如果行为或设置变化），并同步 `manifest.json` 的 `version`。
4. 在 PR 描述中说明：
   - 改了什么；
   - 如何测试；
   - 是否影响 Gopeed 版本兼容性。
5. 不要附加真实 Cookie、签名 URL 或完整下载文件。

## 安全问题

不要通过公开 issue 报告安全问题。请阅读 [SECURITY.md](SECURITY.md)。
