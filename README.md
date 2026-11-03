<p align="center">
  <img src="docs/images/banner.svg" alt="itch.io Downloader for Gopeed" width="100%">
</p>

# itch.io Downloader for Gopeed

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/HanphoneJan/gopeed-extension-itch?style=flat-square"></a>
  <a href="https://github.com/HanphoneJan/gopeed-extension-itch/releases"><img alt="Version" src="https://img.shields.io/github/v/release/HanphoneJan/gopeed-extension-itch?style=flat-square"></a>
  <a href="https://github.com/HanphoneJan/gopeed-extension-itch/actions/workflows/test.yml"><img alt="Tests" src="https://github.com/HanphoneJan/gopeed-extension-itch/actions/workflows/test.yml/badge.svg"></a>
  <img alt="Gopeed" src="https://img.shields.io/badge/Gopeed-1.9.3%2B-2ea44f?style=flat-square">
  <img alt="Runtime dependencies" src="https://img.shields.io/badge/runtime%20deps-0-blue?style=flat-square">
</p>

<p align="center">
  把公开/免费的 itch.io 游戏页面解析成 Gopeed 可直接下载的完整文件列表：APK、Windows、macOS、Linux 等。
</p>

<p align="center">
  <b>中文</b> · <a href="README.en.md">English</a>
</p>

---

> [!WARNING]
> **下载大文件前，请把 Gopeed 的「连接数」设为 1。**
> itch.io 的下载地址只有约 60 秒有效期；Gopeed 默认多连接下载时，过期后新建的连接可能失败，文件会出现空洞，表现为 APK 安装时提示“安装包损坏”。连接数设为 1 可以避免这个问题。
>
> 连接数 1 通常会比多连接慢一些，尤其在高速率、高延迟链路上；但它能换来完整文件。小文件如果能在 60 秒内下载完，可以保留 Gopeed 默认多连接。建议只对 itch.io 的大文件按任务设置，不必改全局默认。

## 功能

- 列出页面上的**全部可下载文件**，保留真实文件名、大小和平台。
- 支持 APK、Windows、macOS、Linux 等文件；不会只返回 APK。
- 可按平台排序：APK、Windows、macOS、Linux 优先项可选。
- 自动处理 itch.io 的临时下载地址，并在开始下载前刷新。
- 登录/年龄门/无文件/外部链接/限流都有明确提示，不绕过认证。
- 可选 Cookie；公开页面通常不需要。
- 纯 JavaScript，无运行时依赖；不记录 Cookie、CSRF 或签名 URL。

> [!IMPORTANT]
> 仅支持**公开/免费**的 itch.io 内容。不绕过登录、购买或年龄确认。请遵守 itch.io 的服务条款和作者的授权。

---

## 兼容性

- **Gopeed 1.9.3 及以上**。
- 桌面版和 Android 版使用同一套扩展 API；Linux 和 Android 已实际验证。
- 需要能访问 `itch.io` 和 `cloudflarestorage.com`；如果网络受限，请配置 Gopeed 的代理。

---

## 安装

### 扩展市场（推荐）

打开 Gopeed → 扩展 → 市场，搜索：

```text
itch
```

或：

```text
itch.io
```

找到 **itch.io Downloader** 后点击安装。市场中的扩展 ID 是 `hanphone@itch-io-downloader`。

<p align="center">
  <img src="docs/images/market-search.png" alt="Gopeed 扩展市场搜索 itch" width="760">
</p>

<p align="center"><sub>在 Gopeed 扩展市场搜索 <code>itch</code> 即可找到。</sub></p>

### Git / 手动安装

如果市场暂时没有刷新，或需要指定版本，在 Gopeed → 扩展 → 手动安装中填入：

```text
https://github.com/HanphoneJan/gopeed-extension-itch
```

安装后无需重启 Gopeed，重新解析页面即可。

> 开发者本地调试、Android 手动测试和测试脚本说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

---

## 使用

粘贴 itch.io 游戏主页，例如：

```text
https://mrdrnose.itch.io/votv
```

然后点击解析。Gopeed 会显示页面上的所有可下载项：

- Android APK
- Windows/macOS/Linux 压缩包或安装包
- 作者上传的其他文件

按需要勾选文件 → 下载。

> [!NOTE]
> 文件类型以 itch.io 返回的**真实文件名**为准，页面上的平台标签只用于排序。不同作者的上传命名可能不一样，请以实际文件名为准。

> [!IMPORTANT]
> 示例页面 `https://mrdrnose.itch.io/votv` 是 **Name your own price** 游戏：需要先在 itch.io 领取/购买，并在扩展设置中填写 Cookie，页面才会出现下载按钮。未领取或未提供 Cookie 时，扩展会提示“页面没有可下载文件”，这是正常现象，不是扩展故障。

> [!WARNING]
> 大文件请先把下载连接数设为 **1**，尤其是 1 GB 以上的文件或慢速网络。

---

## 设置

| 名称 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `platform` | string | `all` | `all`：列出全部上传；`apk`：只返回 APK；`desktop`：只返回 Windows/macOS/Linux 文件。 |
| `preferredPlatform` | string | `auto` | 文件排序：`auto`（APK 优先，然后桌面）、`android`、`windows`、`macos`、`linux`、`none`（页面顺序）。 |
| `includeArm32` | boolean | `false` | 仅对 `platform=apk` 生效。`platform=all` 始终列出 arm32 APK。 |
| `cookie` | string | 空 | 可选。登录/年龄门页面需要时填写；只发送给 itch.io。 |
| `fingerprint` | string | `chrome` | 浏览器指纹。`chrome` 最稳；`none` 使用 Gopeed 默认客户端。 |

设置修改后重新解析页面即可生效。

### 只想看某一类文件？

把 `platform` 设为 `apk` 或 `desktop`，列表就只保留对应类型。Gopeed 仍会默认勾选列出的全部文件，请按需取消。

---

## Cookie（可选）

**先不填 Cookie 试一次。** 公开免费页面通常可以直接解析；以下情况才需要：

- 页面要求登录才能看到下载按钮；
- 页面要求年龄确认，而你的浏览器会话已经确认过；
- itch.io 对匿名请求返回 403。

获取方式（不要把 Cookie 发到聊天、issue 或仓库）：

1. 登录 itch.io，并完成需要的年龄确认。
2. 打开开发者工具 → Network。
3. 刷新目标游戏页面，点第一个发往 `*.itch.io` 的请求。
4. 复制请求头里的 **`Cookie` 值**。
5. 粘贴到扩展设置的 `cookie` 字段。

> [!CAUTION]
> Cookie 等同于登录凭据。只应包含 itch.io 域名的 cookie；不要提交到 GitHub、issue 或日志。Gopeed 会把扩展设置保存在自己的配置/存储中。

---

## 下载地址有效期

itch.io 返回的下载地址约 **60 秒**有效。扩展会在开始下载前刷新一次；任务因 401/403 失败时也会尝试刷新并继续。

但下载过程中如果连接断开，且新连接在 60 秒后才建立，Gopeed 可能无法用旧地址恢复。此时可能出现：

- 任务显示完成，但文件实际有空洞；
- APK 安装时提示“安装包损坏”；
- `unzip -t` 报错。

**解决方法：把 Gopeed 的连接数设为 1，重新下载。** 单连接建立后可以持续读取，不受 60 秒后新建连接的限制。

下载完成后可以用以下命令检查 APK：

```bash
unzip -t 文件名.apk
```

看到 `No errors detected` 才算完整。

### 连接数设为 1 会不会更慢？

可能会。单连接在高速率、高延迟或丢包链路上通常不如多连接，因为多连接可以并行填充带宽；但如果瓶颈是你的代理、Wi-Fi 或 R2 单连接本身，多连接不一定更快，反而会增加重试和分块开销。

多连接的主要作用不是“线性提速”，而是绕过单连接限速、降低高延迟链路的总耗时。对 itch.io 的 60 秒临时地址来说，**连接建立得越晚，越容易失败**；大文件优先用 1 连接换完整性。

### 为什么连接数=1，任务仍可能“瞬间完成”但文件损坏？

Gopeed 1.9.3 的 HTTP 下载器在连接提前 EOF 时，会把这一个连接直接标记为完成，不校验该连接是否真的读满了分配的字节数。代理/VPN/网络中断都可能让连接提前结束，文件被预分配为完整大小，但实际内容留下零填充空洞，任务却显示 `done`。

1 连接只能减少“并行新建连接”，不能防止**单连接提前结束**。可尝试：

- 关闭代理/VPN，让 `cloudflarestorage.com` 直连；
- 使用稳定的 Wi-Fi，保持 Gopeed 在前台/屏幕常亮；
- 下载后必须用 `unzip -t` 检查；
- 对超大文件，使用会校验 `Content-Length` 的下载工具，或等待 Gopeed 修复该行为。

### 能否用 1 连接获取 URL，再多连接下载？

可以，Gopeed 现在就是这样做的：解析/onStart 只获取一次签名 URL，下载时用这个 URL 发多个 Range 请求。

问题不在“获取 URL”，而在 URL 的 60 秒有效期：Gopeed 在下载过程中新建或重试的连接如果超过 60 秒，会被 R2 拒绝。要想安全地多连接，需要每次连接都拿到新 URL（例如一个稳定的本地代理，把每个 Range 请求 302 到新签名 URL）。这需要额外的本地服务，当前扩展做不到，所以大文件仍建议 1 连接。

---

## 排错

| 现象/错误 | 处理 |
| --- | --- |
| 扩展在市场里搜不到 | 搜索 `itch` 或 `itch.io`；市场索引可能延迟，也可用 README 里的 Git 地址手动安装。 |
| `这不是 itch.io 游戏主页 URL` | 粘贴 `https://mrdrnose.itch.io/votv`，不要粘贴列表页或 devlog 页面。 |
| `页面缺少 CSRF token` | 可能需要登录/年龄确认；填写 Cookie 后重试。 |
| `该页面需要登录才能查看下载` | 在设置里填 Cookie。扩展不会绕过登录。 |
| `该页面需要年龄确认` | 先在浏览器完成年龄确认，再用同一会话的 Cookie。 |
| `页面没有可下载文件` | 可能尚未发布、已下架、需要购买/领取，或上传已移除。VOTV 示例页面需要先领取并填写 Cookie；未领取时出现此提示是正常的。 |
| `签名链接获取失败（HTTP 403）` | Cookie 失效/缺失，或请求被 itch.io 拒绝；重新获取 Cookie 或稍后重试。 |
| `签名链接获取失败（HTTP 429）` | itch.io 限流；等几分钟再试。 |
| 安装时提示“安装包损坏” | 删除任务和文件，连接数设为 **1**，用稳定直连重新下载并 `unzip -t`。若仍失败，可能是 Gopeed 提前 EOF 的已知限制。 |
| 下载 403/文件不完整 | 临时地址过期或连接在 60 秒后重建；连接数设为 1 后重试。 |

日志位置：Gopeed 的 `logs/extension.log`。扩展日志只包含公开的文件名和状态；URL、Cookie、CSRF、签名参数会被脱敏。

---

## 限制

- 不支持付费游戏、需要购买的页面。
- 不支持绕过登录或年龄确认；需要用户自己提供 Cookie。
- 不支持指向外部站点的上传（`external: true`）。
- 只支持 `author.itch.io` 子域名下的游戏主页。
- 页面结构变化后可能需要更新解析逻辑。
- 下载中途断线且超过 60 秒时，无法保证自动续传。
- Gopeed 解析对话框会默认勾选全部文件，扩展无法只勾选一个；可用 `platform` 过滤或手动取消。
- 无法自动检测宿主系统；`preferredPlatform=auto` 是“APK 优先”的固定排序，不是系统探测。

---

## 安全与隐私

- Cookie 只在请求 `*.itch.io` 时发送；不写日志。
- CSRF token 只在内存中用于请求；不写入标签、storage 或日志。
- 签名 URL 只存在于返回给 Gopeed 的下载请求和 Gopeed 自己的任务数据中；扩展日志不输出。
- 不在仓库中保存 Cookie、token、签名 URL 或下载的文件。
- 安全问题请阅读 [SECURITY.md](SECURITY.md)，不要在公开 issue 中贴凭据。

---

## 开发与贡献

开发环境、Gopeed API 兼容性、单元测试、真实 Gopeed 冒烟测试和发布流程见：

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

---

## License

MIT © 2026 HanphoneJan. See [LICENSE](LICENSE).

## Acknowledgements

- [Gopeed](https://github.com/GopeedLab/gopeed) for the downloader and extension API.
- [itch.io](https://itch.io) for the platform.
- The open-source community for testing and documentation patterns.

> This project is not affiliated with itch.io or Gopeed. Download only content you are allowed to download.
