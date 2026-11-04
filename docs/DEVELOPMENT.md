# Development

本文面向修改扩展代码、调试 Gopeed 兼容性或运行测试的开发者。普通安装和使用请回到 [README](../README.md)。

## 环境

- Node.js 20+（仅测试需要）
- Gopeed 1.9.3+（桌面版或 Android 版）
- 无 npm 依赖；`index.js` 直接由 Gopeed 加载

## 本地安装

### 桌面开发者模式

1. 打开 Gopeed → 扩展。
2. 连续点击“安装”按钮 5 次，启用开发者模式。
3. 选择本仓库根目录（包含 `manifest.json`）。
4. 修改 `index.js` 后重新解析页面即可，无需重启。

### Android 调试

Android 版 Gopeed 没有桌面端的“开发者模式目录选择”，调试时使用 **手动安装** 填入一个设备可访问的 git URL。仓库已发布后可直接用：

```text
https://github.com/HanphoneJan/gopeed-extension-itch
```

本地调试可以在电脑上跑一个临时 smart-HTTP git 服务，再用 `adb reverse` 暴露给设备；这是测试环境，不是普通安装方式。

## Gopeed API 兼容性

验证对象：Gopeed **v1.9.3** 和 `main` 分支源码。

| 项目 | 结论 |
| --- | --- |
| `manifest.json` | `name`、`author`、`title`、`description`、`icon`、`version`、`homepage`、`repository`、`scripts[{event,match{urls,labels},entry}]`、`settings[]` |
| `onResolve` | `ctx.req.url` 是页面 URL；赋值 `ctx.res = {name, files}` |
| `onStart` | v1.9.3 直接 `task.meta.req.url = ...`；`main` 使用 `task.meta.req.setUrl(...)`。两者都兼容 |
| `onError` | 支持改 URL 后 `task.continue()` |
| 事件匹配 | `match.labels` 在 v1.9.3 已支持；扩展用 `itchio` 标签匹配 `onStart`/`onError` |
| `task.meta.res.files[].req` | 深拷贝，修改不会影响真实任务；HTTP fetcher 使用 `task.Meta.Req`，扩展不依赖它 |
| `fetch` Cookie | v1.9.3 无 cookie jar；扩展用显式 `Cookie` 设置。`main` 有 jar，但统一使用 `credentials: 'omit'` |
| 签名 URL | 文件接口返回的 R2 URL 约 60 秒过期（`X-Amz-Expires=60`） |
| `gopeed.runtime.blob` | 仅 2.x 提供；`createObjectURL(opener, {size, range})` 注册本地可续传数据源，1.9.x 为 `undefined` |
| 2.0.0-beta.4 实测 | blob 续传可用；代理中途重置连接后，任务从断点继续，`unzip -t` 无错误，APK 安装成功 |

已确认：`onStart` 可以读/改克隆出来的 `task.meta.opts`，但**真实任务的 connections 不会被改回**；因此扩展无法强制单连接，只能文档提示。

## 解析流程

```text
用户粘贴页面 URL
        │
        ▼
GET https://author.itch.io/game
        │  解析 game_title、csrf_token、data-upload_id、平台图标、页面大小
        ▼
POST https://author.itch.io/game/file/<upload_id>?source=view_game&as_props=1
        │  body: csrf_token=<token>
        │  headers: X-Requested-With, Accept: application/json, Referer, 可选 Cookie
        │  带 external_label 的上传（文件在其他站点）在 POST 之前跳过
        ▼
JSON { "url": "https://...r2.cloudflarestorage.com/...", "external": false }
        │
        ▼
GET 签名 URL，Range: bytes=0-0
        │  读取 Content-Disposition（真实文件名）、Content-Range（精确大小）
        ▼
返回 Gopeed files[]（req.url = 签名 URL，req.labels = 页面 URL + upload ID）
        │
        ▼
Gopeed 创建任务 → onStart 重新 GET 页面 + POST 文件接口 → 刷新 req.url → 开始下载
```

`onStart` 在每次开始/继续任务前运行；`onError` 在任务级 401/403 时再刷新一次（最多 3 次）。

## 单元测试

```bash
node --test test/index.test.js
```

覆盖：

- HTML fixture 解析：APK / Windows / macOS / arm32、无文件、登录门、年龄门、缺 CSRF；
- 默认列出全部文件、平台/arm32 选择、只有 arm32 + 桌面文件时回退；
- 文件 POST 的方法、headers、form body、JSON 解析；
- 外部上传（页面标记 `External`）在请求文件接口前跳过，不消耗签名请求；整页都是外部上传时给出明确提示；
- 外部上传与 HTML 响应拒绝；
- `onStart` 刷新（`req.url` 直接赋值和 `setUrl()` 两种 API）；
- `onError` 刷新与重试上限；
- 日志脱敏（不出现 URL/CSRF/Cookie）。

测试全部 mock `fetch`，不会访问网络。

## Gopeed 真实接口测试

`test/gopeed-smoke.mjs` 通过 Gopeed REST API 安装扩展、解析页面、创建任务并可等待完成。它只创建一个任务（有 APK 时只创建 APK），避免误下载几十 GB 文件。

先启动一个 Gopeed（web/server 或桌面版），然后：

```bash
GOPEED_URL=http://127.0.0.1:9999 \
GOPEED_EXT_DIR="$PWD" \
GAME_URL=https://作者.itch.io/游戏 \
GOPEED_STORAGE=/path/to/gopeed/storage \
node test/gopeed-smoke.mjs
```

可选环境变量：

- `GOPEED_WAIT_EXPIRY=65`：解析后等待 65 秒再创建任务，验证 onStart 刷新；
- `GOPEED_DOWNLOAD=1`：等待任务完成并检查文件大小；
- `GOPEED_CONNECTIONS=1`：设置任务连接数（建议 1）；
- `GOPEED_API_TOKEN`：Gopeed 启用 API token 时使用；
- `GOPEED_STORAGE`：自动检查 `logs/extension.log` 是否泄露敏感信息。

## CI

`.github/workflows/test.yml` 在 Node 20 / 22 / 24 上运行：

```bash
node --test test/index.test.js
```

## 发布

```bash
git tag v1.1.0
git push origin v1.1.0
```

Gopeed 通过 git 仓库安装和更新，不需要单独构建产物。市场由 `gopeed.com` 自动索引 GitHub 仓库，通常无需单独提交；索引和 README 可能有延迟。

## 测试记录

- Linux Gopeed 1.9.3：解析目标页面得到 4 个文件；`platform=desktop` 返回 2 个桌面 zip。
- Android Gopeed 1.9.3：安装扩展后解析出 4 个文件，选择 APK 创建任务并开始下载。
- 4 连接 + 慢速/不稳定 R2：任务显示 `done`，但文件出现零填充空洞，`unzip -t` 失败。
- 1 连接：同一 APK 完整下载，`unzip -t` 通过，SHA-256 与完整文件一致。
- 解析后等待 86 秒再创建任务：`onStart` 刷新成功并开始下载。
- `https://mrdrnose.itch.io/votv` 是 Name your own price 页面：未领取/未提供 Cookie 时没有公开上传按钮，正确返回“页面没有可下载文件”。
- Gopeed 1.9.3 的 `internal/protocol/http/fetcher.go` 在 `io.EOF` 时直接把连接标记 `Completed`，没有检查 `conn.Chunk.remain()`。代理/VPN/网络提前关闭连接时，会留下稀疏空洞但任务显示完成；1 连接无法避免。

## 安全注意

- 不要提交 Cookie、CSRF token、签名 URL、下载的游戏文件。
- 测试 fixture 使用假 token 和假域名。
- 发现安全问题请阅读 [SECURITY.md](../SECURITY.md)。

## 可续传数据源（Gopeed 2.x）

1.9.x 只能把签名 URL 直接交给 Gopeed 的 HTTP 下载器。签名 60 秒过期后，断线重试拿到的 403 会被下载器当作“连接数超限”忽略，于是任务显示完成但文件带空洞。1.9.x 没有流式接口，扩展无法介入。

2.x 提供 `gopeed.runtime.blob`，扩展改成本地数据源：

```text
onResolve
  ├─ 探测文件（Range 0-0）得到 name / size / contentType
  ├─ 每个文件 createObjectURL(rangeOpener, {size, range:true})
  └─ files[].req.url = 本地 blob URL，labels 加 itchBlob=1 / itchSize

Gopeed → 本地 blob HTTP 服务 → rangeOpener({offset, end})
  ├─ signedUrlForRange：40 秒缓存 + 并发合并；403 时作废重签
  ├─ fetch(Range: bytes=<pos>-<end>)
  ├─ 逐块 enqueue（每次 pull 一块，提供背压）
  └─ 未读满 → 关掉当前响应，从 pos 重新签名继续（最多 40 次）
```

要点：

- 打开函数只接受 `{offset, end}`，必须返回 `ReadableStream`；不能在失败时直接 `controller.error`，否则本地 blob 源两次报错后会被判定失效。
- 每次 `pull` 只 `enqueue` 一块，避免大文件把整段缓冲进内存。
- `onStart` 遇到 `itchBlob=1` 直接返回，不能把本地 URL 换成签名 URL。
- `onError` 遇到 `itchBlob=1` 时重建数据源再 `task.continue()`，用于应用重启后会话丢失的情况。
- 没有 blob 接口时（1.9.x）自动退回原来的签名 URL 路径，行为不变。

测试：

```bash
node --test test/index.test.js
```

`blob opener resumes from the last byte after a truncated response` 与
`blob opener re-signs and retries when the signed URL expires` 覆盖了截断续传和 403 重签。

## 两个容易踩的坑

- **解析期间的占位行**：v2 在解析完成前会先在文件列表里显示一行占位（名称就是页面 URL），几十秒后才替换成真实文件。不要据此判断“扩展没生效”，等解析结束再看。
- **不要用零字节数判断完整性**：APK 内部可能本来就有大段零数据，统计零字节不能区分“合法的零”和“没写进去的空洞”。验证用 `unzip -t`（或与已知可用的文件比对 MD5）。
