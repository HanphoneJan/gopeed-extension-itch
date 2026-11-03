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
  Resolve public/free itch.io game pages into a complete Gopeed file list: APK, Windows, macOS, Linux, and more.
</p>

<p align="center">
  <a href="README.md">中文</a> · <b>English</b>
</p>

---

> [!WARNING]
> **Set Gopeed's HTTP connections to 1 before downloading large files.**
> itch.io download URLs expire in about 60 seconds. With Gopeed's default multi-connection mode, connections created after expiry can fail and leave zero-filled holes; the APK may then fail to install with a "package is corrupt" message. One connection avoids this.
>
> One connection can be slower, especially on high-bandwidth, high-latency links, but it gives you a complete file. For small files that finish within 60 seconds, the default multi-connection mode is usually fine. Set this per task for itch.io large files; there is no need to change the global default for other sites.

## Features

- Lists **every downloadable file** on the page, with real names, sizes, and platforms.
- Supports APK, Windows, macOS, Linux, and other files; it is not APK-only.
- Optional platform sorting: APK, Windows, macOS, or Linux first.
- Handles itch.io's temporary download URLs and refreshes them before download.
- Clear errors for login, age gates, no files, external links, and rate limits; never bypasses authentication.
- Optional Cookie; public pages usually need none.
- Pure JavaScript, zero runtime dependencies; does not log cookies, CSRF tokens, or signed URLs.

> [!IMPORTANT]
> Only **public/free** itch.io content is supported. The extension does not bypass login, purchase, or age checks. Respect itch.io's terms and the creator's license.

---

## Compatibility

- **Gopeed 1.9.3+**.
- Desktop and Android use the same extension API; Linux and Android have been tested.
- `itch.io` and `cloudflarestorage.com` must be reachable; configure a proxy in Gopeed if your network requires one.

---

## Install

### Gopeed extension market (recommended)

Open Gopeed → Extensions → Market and search for:

```text
itch
```

or:

```text
itch.io
```

Find **itch.io Downloader** and install it. The market extension ID is `hanphone@itch-io-downloader`.

<p align="center">
  <img src="docs/images/market-search.png" alt="Searching the Gopeed extension market" width="760">
</p>

<p align="center"><sub>Search <code>itch</code> in the Gopeed extension market.</sub></p>

### Git / manual install

If the market has not updated yet, or you need a specific version, open Gopeed → Extensions → Manual install and enter:

```text
https://github.com/HanphoneJan/gopeed-extension-itch
```

No restart is needed; re-resolve the page after installation.

> Local developer setup, Android testing, and test scripts are documented in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## Usage

Paste an itch.io game page, for example:

```text
https://mrdrnose.itch.io/votv
```

Then click resolve. Gopeed shows every downloadable file on the page:

- Android APK
- Windows/macOS/Linux archives or installers
- Other files uploaded by the author

Select what you need, then download.

> [!NOTE]
> File types are determined by the **real filename** returned by itch.io. Platform labels on the page are only used for sorting; authors may name uploads differently.

> [!IMPORTANT]
> The example page `https://mrdrnose.itch.io/votv` is a **Name your own price** game. You must claim/purchase it on itch.io and put your Cookie in the extension settings before its download buttons appear. Without claiming it or providing a Cookie, the extension will report "no downloadable files"; that is expected, not a bug.

> [!WARNING]
> For large files, set the task's connection count to **1**, especially for files over 1 GB or on a slow network.

---

## Settings

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `platform` | string | `all` | `all`: every upload; `apk`: APK only; `desktop`: Windows/macOS/Linux files only. |
| `preferredPlatform` | string | `auto` | Sort order: `auto` (APK first, then desktop), `android`, `windows`, `macos`, `linux`, or `none` (page order). |
| `includeArm32` | boolean | `false` | Only applies to `platform=apk`. `platform=all` always lists arm32 APKs. |
| `cookie` | string | empty | Optional. Needed for login/age-gated pages; sent only to itch.io. |
| `fingerprint` | string | `chrome` | Browser fingerprint. `chrome` is recommended; `none` uses Gopeed's default client. |

Settings take effect on the next resolve.

### Only want one type of file?

Set `platform` to `apk` or `desktop` to keep only that type. Gopeed still preselects every listed file; uncheck the ones you do not want.

---

## Cookie (optional)

**Try without a Cookie first.** Public/free pages usually resolve directly. A Cookie is needed when:

- the page requires login to show download buttons;
- the page requires age confirmation and your browser session has already confirmed it;
- itch.io returns 403 for anonymous requests.

How to get it (never post it in chat, issues, or the repository):

1. Log in to itch.io and complete any required age confirmation.
2. Open developer tools → Network.
3. Refresh the game page and click the first request to `*.itch.io`.
4. Copy the **`Cookie` value** from the request headers.
5. Paste it into the extension's `cookie` setting.

> [!CAUTION]
> A Cookie is a login credential. Only include itch.io cookies; never commit it to GitHub, paste it in an issue, or write it to logs. Gopeed stores extension settings in its own configuration/storage.

---

## Signed URL lifetime

itch.io's download URL is valid for about **60 seconds**. The extension refreshes it before starting the download and tries to refresh again when a task fails with 401/403.

If a connection drops and a new one starts after 60 seconds, Gopeed may not be able to recover with the old URL. Symptoms include:

- the task shows `done` but the file has zero-filled holes;
- the APK fails to install with "package is corrupt";
- `unzip -t` fails.

**Fix: set Gopeed's HTTP connections to 1 and download again.** A single connection can keep reading after the URL expiry.

Verify an APK with:

```bash
unzip -t filename.apk
```

`No errors detected` means the archive is complete.

### Is one connection slower?

Possibly. A single connection is often slower on high-bandwidth, high-latency, or lossy links, where multiple connections can fill the pipe. But if your proxy, Wi-Fi, or R2 single-stream throughput is the bottleneck, multiple connections may not help and can add retry/chunk overhead.

Multiple connections do not give linear speedup. Their main benefit is working around per-connection throttling and reducing total time on high-latency links. With itch.io's 60-second URL, **later connections are more likely to fail**; for large files, one connection is the safer trade.

### Why can a one-connection task still finish "instantly" and produce a corrupt file?

Gopeed 1.9.3 marks an HTTP connection as complete when it sees an early EOF, without checking whether the connection actually read all bytes assigned to it. A proxy/VPN/network interruption can close the connection early; Gopeed has already preallocated the full file, so the task shows `done` while the content contains zero-filled holes.

One connection only reduces parallel connection creation; it cannot prevent a **single connection from ending early**. Try:

- Disable VPN/proxy so `cloudflarestorage.com` is reached directly;
- Use stable Wi-Fi and keep Gopeed in the foreground/screen on;
- Always verify with `unzip -t`;
- For very large files, use a downloader that validates `Content-Length`, or wait for an upstream Gopeed fix.

### Can we fetch the URL with one connection and download with many?

Yes — Gopeed already does that: the extension resolves the signed URL once, and Gopeed uses it for multiple Range requests.

The problem is not fetching the URL, but its 60-second lifetime: connections opened or retried after 60 seconds are rejected by R2. Safe multi-connection would need a fresh URL per connection, for example a stable local proxy that redirects every Range request to a newly signed URL. That requires an extra local service and is not possible inside a pure Goja extension, so one connection remains the practical choice for large files.

---

## Troubleshooting

| Symptom / error | Fix |
| --- | --- |
| Extension not found in the market | Search `itch` or `itch.io`; the market index may lag. You can also install via the Git URL above. |
| `Not an itch.io game page URL` | Paste `https://author.itch.io/game`, not a list page or devlog page. |
| `Missing CSRF token` | The page may need login/age confirmation; add a Cookie and retry. |
| `This page requires login` | Add a Cookie in settings. The extension does not bypass login. |
| `This page requires age confirmation` | Confirm age in a browser, then use that session's Cookie. |
| `No downloadable files` | The game may be unpublished, delisted, paid/claimed, or the uploads were removed. The VOTV example requires claiming the game and a Cookie first. |
| `Failed to get signed URL (HTTP 403)` | Cookie expired/missing, or itch.io rejected the request; refresh the Cookie or retry later. |
| `Failed to get signed URL (HTTP 429)` | itch.io rate limit; wait a few minutes. |
| Installer says "package is corrupt" | Delete the task/file, set connections to **1**, download over a stable direct connection, and run `unzip -t`. If it still fails, this may be Gopeed's early-EOF limitation. |
| Download 403/incomplete | Signed URL expired or a connection was recreated after 60 seconds; set connections to 1 and retry. |

Logs: Gopeed's `logs/extension.log`. The extension logs only public filenames and states; URLs, cookies, CSRF values, and signed parameters are redacted.

---

## Limitations

- No paid games or pages that require purchase.
- No bypassing login or age confirmation; the user must provide a Cookie.
- No uploads that point to external sites (`external: true`).
- Only `author.itch.io` game pages.
- Page structure changes may require a parser update.
- Automatic resume after a dropped connection is not guaranteed if more than 60 seconds pass.
- Gopeed preselects all files in the resolve dialog; the extension cannot preselect only one. Use `platform` to filter or uncheck manually.
- Host OS detection is not available; `preferredPlatform=auto` is a fixed "APK first" order, not OS detection.

---

## Security and privacy

- Cookies are sent only to `*.itch.io` and are never logged.
- CSRF tokens are used in memory and are not written to labels, storage, or logs.
- Signed URLs only exist in the Gopeed download request and Gopeed's own task data; the extension does not log them.
- No cookies, tokens, signed URLs, or downloaded game files are stored in this repository.
- For security reports, read [SECURITY.md](SECURITY.md) and do not post credentials in public issues.

---

## Development and contributing

See:

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
