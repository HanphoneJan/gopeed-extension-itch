# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2026-11-04

### Added

- `externalHints` setting (default on): every upload that itch.io marks
  `External` now appears in the resolve dialog as a small `.txt` file with that
  file's link, so a page whose installers live on MediaFire/MEGA no longer looks
  like it only has one file. The hint task re-signs and rebuilds its blob in
  `onStart`, like normal downloads.
- Hints are generated only when the blob runtime exists (Gopeed 2.x); on 1.9.x
  external uploads are still skipped, and a page with only external uploads
  still fails with an explanation.

### Changed

- `probeUploads` now returns hosted files and external uploads separately, and
  resolving a page that only has external uploads returns hint files instead of
  a generic error on 2.x.

## [1.2.1] - 2026-11-04

### Changed

- Uploads marked `External` on the game page are now detected from the HTML and
  skipped before the signed-URL request. A page that mixes itch.io-hosted and
  external uploads no longer spends one POST per external file, and a page whose
  uploads are all external fails with an explanation instead of a generic
  "no downloadable files" error.
- README troubleshooting explains why a page with several installers can list a
  single file: the others live on MediaFire, MEGA, or another host.

## [1.2.0] - 2026-11-04

### Added

- Resumable downloads on Gopeed 2.x through `gopeed.runtime.blob`: every Range
  request re-signs the itch.io URL, an interrupted connection continues from the
  last received byte, and a partial file is never reported as complete.
- `onError` rebuilds the resumable source after an app restart and continues from
  the bytes already on disk.

### Verified

- Gopeed 2.0.0-beta.4 (Android) with a proxy that resets the connection partway
  through a ~560 MB download: the task resumed from the last received byte,
  finished, passed `unzip -t`, and the APK installed successfully.

### Changed

- Documented the 1.9.x workaround for multi-connection corruption: set HTTP
  connections to 1 before downloading large itch.io files.
- Added a troubleshooting entry for "installer says the package is corrupt"
  and an `unzip -t` verification tip.
- Reorganized README for end users; developer mode, API notes, and test
  details moved to `docs/DEVELOPMENT.md`.
- Added `README.en.md`; removed the inline English summary from the Chinese README.
- Switched the documentation example to `https://mrdrnose.itch.io/votv`
  (Name your own price: claim the game and provide a Cookie first).
- Documented Gopeed 1.9.3's early-EOF behavior as a cause of sparse/corrupt
  files even with one connection.

## [1.1.0] - 2026-11-03

### Added

- `preferredPlatform` setting: order APK/Windows/macOS/Linux files first.
- Default `platform=all`: list every upload instead of APK only.
- Android Gopeed 1.9.3 verification (manual git install, file list, task creation).
- Screenshots and banner for the README.
- CI workflow, issue templates, contributing/security docs.

### Changed

- `platform=apk` now keeps its filter behavior; `all` is the default.
- `platform=all` always includes arm32 APKs.
- File names/sizes come from `Content-Disposition` / `Content-Range` probes.
- README reorganized for open-source release.

### Fixed

- Do not silently fall back to desktop files when the APK probe is rate-limited (HTTP 429) or rejected.
- Reject external uploads and HTML responses instead of treating them as files.

## [1.0.0] - 2026-11-03

### Added

- Initial Gopeed extension for public/free itch.io game pages.
- Parse `data-upload_id`, `csrf_token`, title, platform tags, and page sizes.
- POST itch.io file endpoint and resolve signed R2 URLs.
- APK-first selection, arm32 option, `onStart` refresh, `onError` refresh.
- Unit tests with HTML fixtures and mocked file POST.
- README, MIT license, `.gitignore`.
