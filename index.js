/*
 * Gopeed itch.io download resolver.
 *
 * Scope: public/free itch.io game pages only. This extension never bypasses
 * login, purchase, or age gates. A user-provided cookie is only forwarded to
 * itch.io when the page needs an existing session.
 *
 * The direct file URL is obtained from itch.io's JSON file endpoint and points
 * at a short-lived signed R2 URL. It is refreshed again in onStart (and once
 * more on a 401/403 download error) so a task that starts later still works.
 *
 * No cookie, CSRF token, or signed URL is written to the extension log.
 */
(function () {
  'use strict';

  var LABEL = 'itchio';
  var MAX_UPLOADS = 20;
  var MAX_ERROR_REFRESHES = 3;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function isArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function redact(value) {
    var text = value === undefined || value === null ? '' : String(value);
    text = text.replace(/https?:\/\/[^\s"'<>]+/gi, '<url>');
    text = text.replace(/(csrf_token\s*=\s*)[^&\s"']+/gi, '$1<redacted>');
    text = text.replace(/(cookie\s*:\s*)[^\r\n]+/gi, '$1<redacted>');
    text = text.replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|token)=)[^&\s"']+/gi, '$1<redacted>');
    text = text.replace(/(itchio_token\s*=\s*)[^;\s]+/gi, '$1<redacted>');
    return text;
  }

  function safeMessage(error) {
    if (!error) {
      return 'unknown error';
    }
    var message = error.message ? error.message : String(error);
    message = redact(message);
    return message.length > 300 ? message.slice(0, 300) + '...' : message;
  }

  function throwUser(message) {
    var ErrorCtor = typeof MessageError !== 'undefined' ? MessageError : Error;
    throw new ErrorCtor(message);
  }

  function decodeHtml(value) {
    var text = value === undefined || value === null ? '' : String(value);
    text = text.replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
    text = text.replace(/&#([0-9]+);/g, function (_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    });
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
  }

  function stripTags(value) {
    return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '));
  }

  function cleanText(value) {
    return stripTags(value).replace(/\s+/g, ' ').trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Reads one attribute from a tag's attribute source (the text inside <tag ...>).
  function attr(attributeSource, name) {
    if (!attributeSource) {
      return '';
    }
    var re = new RegExp(
      '(^|[\\s"\'])(' + escapeRegExp(name) + ')\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
      'i'
    );
    var match = re.exec(attributeSource);
    if (!match) {
      return '';
    }
    var raw = match[4] !== undefined ? match[4] : match[5] !== undefined ? match[5] : match[6];
    return decodeHtml(raw);
  }

  function tagAttr(tag, name) {
    var source = String(tag || '').replace(/^<\s*[a-z0-9:-]+/i, '').replace(/\/?>\s*$/, '');
    return attr(source, name);
  }

  function sanitizeFilename(value) {
    var name = String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '');
    if (!name) {
      name = 'download';
    }
    if (name.length > 180) {
      var dot = name.lastIndexOf('.');
      var ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
      name = name.slice(0, 180 - ext.length) + ext;
    }
    return name;
  }

  function sanitizeFolderName(value) {
    var name = sanitizeFilename(value);
    if (!name || name === 'download') {
      return 'itch.io game';
    }
    return name;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  function normalizeCookie(value) {
    var cookie = value === undefined || value === null ? '' : String(value).trim();
    if (!cookie) {
      return '';
    }
    cookie = cookie.replace(/^cookie\s*:\s*/i, '');
    // Header values are single-line; fold accidental line breaks instead of
    // passing them to the HTTP layer.
    cookie = cookie.replace(/[\r\n]+/g, '; ').replace(/;\s*;/g, ';').trim();
    return cookie;
  }

  function readSettings(raw) {
    var source = raw || {};
    var platform = String(source.platform || 'all').toLowerCase();
    if (platform !== 'apk' && platform !== 'desktop' && platform !== 'all') {
      platform = 'all';
    }
    var preferredPlatform = String(source.preferredPlatform || 'auto').toLowerCase();
    if (['auto', 'android', 'windows', 'macos', 'linux', 'none'].indexOf(preferredPlatform) < 0) {
      preferredPlatform = 'auto';
    }
    var fingerprint = String(source.fingerprint || 'chrome').toLowerCase();
    if (['chrome', 'firefox', 'safari', 'none'].indexOf(fingerprint) < 0) {
      fingerprint = 'chrome';
    }
    var includeArm32 = source.includeArm32 === true || source.includeArm32 === 'true';
    return {
      cookie: normalizeCookie(source.cookie),
      platform: platform,
      preferredPlatform: preferredPlatform,
      includeArm32: includeArm32,
      fingerprint: fingerprint
    };
  }

  function applyFingerprint(settings) {
    try {
      if (typeof __gopeed_setFingerprint === 'function') {
        if (settings.fingerprint && settings.fingerprint !== 'none') {
          __gopeed_setFingerprint(settings.fingerprint);
        } else {
          __gopeed_setFingerprint('none');
        }
      }
    } catch (error) {
      // Older Gopeed builds do not expose the fingerprint hook.
    }
  }

  // ---------------------------------------------------------------------------
  // Page URL and HTML parsing
  // ---------------------------------------------------------------------------

  function normalizePageUrl(input) {
    var url;
    try {
      url = new URL(String(input || '').trim());
    } catch (error) {
      throwUser('URL 无效。请粘贴 itch.io 游戏主页，例如 https://author.itch.io/game。');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throwUser('只支持 http(s) 的 itch.io 页面 URL。');
    }
    var host = url.hostname.toLowerCase();
    if (host !== 'itch.io' && !/\.itch\.io$/.test(host)) {
      throwUser('只支持 itch.io 域名。');
    }
    if (host === 'itch.io' || host === 'www.itch.io') {
      throwUser('请粘贴作者子域名下的游戏主页，例如 https://author.itch.io/game。');
    }
    var parts = url.pathname.split('/').filter(function (part) {
      return part.length > 0;
    });
    if (parts.length !== 1) {
      throwUser('只支持 itch.io 游戏主页 URL（https://author.itch.io/<game-slug>）。');
    }
    var slug = parts[0];
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
      throwUser('游戏页面 URL 无效。');
    }
    return {
      base: 'https://' + host + '/' + slug,
      host: host,
      slug: slug
    };
  }

  function bodyPageName(html) {
    var body = /<body\b[^>]*>/i.exec(html);
    if (!body) {
      return '';
    }
    return tagAttr(body[0], 'data-page_name').toLowerCase();
  }

  function detectGate(html) {
    var pageName = bodyPageName(html);
    if (pageName === 'login' || pageName === 'register') {
      return 'login';
    }
    if (pageName === 'age_gate' || pageName === 'age-gate') {
      return 'age';
    }
    if (/id\s*=\s*["'](?:age_gate|age-gate|age_gate_form)["']/i.test(html) ||
        /class\s*=\s*["'][^"']*\bage[_-]?gate\b/i.test(html)) {
      return 'age';
    }
    if (/id\s*=\s*["']login_page["']/i.test(html) ||
        /class\s*=\s*["'][^"']*\blogin_page\b/i.test(html)) {
      return 'login';
    }
    if (/(you must be logged in|log in to (?:view|download)|login (?:is )?required)/i.test(html)) {
      return 'login';
    }
    if (/(not_found_page|we couldn't find your page|page not found)/i.test(html)) {
      return 'notfound';
    }
    if (pageName && pageName !== 'view_game' && pageName !== 'game') {
      return 'notgame';
    }
    var hasViewGame = /id\s*=\s*["']view_game[^"']*["']/i.test(html) ||
      /class\s*=\s*["'][^"']*\bview_game_page\b/i.test(html);
    var hasGameTitle = /class\s*=\s*["'][^"']*\bgame_title\b/i.test(html);
    if (!hasViewGame && !hasGameTitle) {
      return 'notgame';
    }
    return '';
  }

  function gateMessage(gate) {
    if (gate === 'login') {
      return '该页面需要登录才能查看下载。请在扩展设置中填写 itch.io Cookie 后重试；扩展不会绕过登录。';
    }
    if (gate === 'age') {
      return '该页面需要年龄确认，扩展不会绕过年龄门。请先在浏览器中完成确认，或填写已确认会话的 Cookie 后重试。';
    }
    if (gate === 'notfound') {
      return '页面不存在或已下架（HTTP 404）。请检查游戏 URL。';
    }
    return '这不是 itch.io 游戏主页 URL。请粘贴 https://作者.itch.io/游戏 页面。';
  }

  function findCsrf(html) {
    var metas = html.match(/<meta\b[^>]*>/gi) || [];
    for (var i = 0; i < metas.length; i++) {
      var tag = metas[i];
      var name = tagAttr(tag, 'name') || tagAttr(tag, 'id');
      if (name === 'csrf_token') {
        var value = tagAttr(tag, 'value');
        if (value) {
          return value;
        }
      }
    }
    var inputs = html.match(/<input\b[^>]*>/gi) || [];
    for (var j = 0; j < inputs.length; j++) {
      if (tagAttr(inputs[j], 'name') === 'csrf_token') {
        var inputValue = tagAttr(inputs[j], 'value');
        if (inputValue) {
          return inputValue;
        }
      }
    }
    return '';
  }

  function pageTitle(html) {
    var h1 = /<h1\b[^>]*class\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/h1>/gi;
    var match;
    while ((match = h1.exec(html))) {
      var classes = match[2] !== undefined ? match[2] : match[3];
      if (/\bgame_title\b/i.test(classes || '')) {
        var title = cleanText(match[4]);
        if (title) {
          return title;
        }
      }
    }
    var metas = html.match(/<meta\b[^>]*>/gi) || [];
    for (var i = 0; i < metas.length; i++) {
      var property = tagAttr(metas[i], 'property') || tagAttr(metas[i], 'name');
      if (property === 'og:title') {
        var og = cleanText(tagAttr(metas[i], 'content'));
        if (og) {
          return og.replace(/\s+by\s+[^|]+$/i, '').trim();
        }
      }
    }
    var docTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (docTitle) {
      return cleanText(docTitle[1]).replace(/\s+by\s+.+$/i, '').trim();
    }
    return '';
  }

  function parseHumanSize(value) {
    var text = cleanText(value);
    var match = /([\d.,]+)\s*(bytes?|[kmgt]i?b)\b/i.exec(text);
    if (!match) {
      return 0;
    }
    var amount = parseFloat(match[1].replace(/,/g, ''));
    if (!isFinite(amount) || amount < 0) {
      return 0;
    }
    var unit = match[2].toLowerCase();
    var factors = {
      b: 1,
      byte: 1,
      bytes: 1,
      kb: 1024,
      kib: 1024,
      mb: 1024 * 1024,
      mib: 1024 * 1024,
      gb: 1024 * 1024 * 1024,
      gib: 1024 * 1024 * 1024,
      tb: 1024 * 1024 * 1024 * 1024,
      tib: 1024 * 1024 * 1024 * 1024
    };
    return Math.round(amount * (factors[unit] || 1));
  }

  function parsePlatforms(block) {
    var found = {};
    var platformRe = /title\s*=\s*"Download for ([^"]+)"/gi;
    var match;
    while ((match = platformRe.exec(block))) {
      var label = match[1].toLowerCase();
      if (/windows|win/.test(label)) {
        found.windows = true;
      }
      if (/mac|osx|apple/.test(label)) {
        found.macos = true;
      }
      if (/linux/.test(label)) {
        found.linux = true;
      }
      if (/android/.test(label)) {
        found.android = true;
      }
      if (/web|html5/.test(label)) {
        found.web = true;
      }
    }
    var iconRe = /class\s*=\s*"[^"]*icon-(windows8|apple|tux|linux|android|html5|web)[^"]*"/gi;
    while ((match = iconRe.exec(block))) {
      var icon = match[1].toLowerCase();
      if (icon === 'windows8') {
        found.windows = true;
      } else if (icon === 'apple') {
        found.macos = true;
      } else if (icon === 'tux' || icon === 'linux') {
        found.linux = true;
      } else if (icon === 'android') {
        found.android = true;
      } else if (icon === 'html5' || icon === 'web') {
        found.web = true;
      }
    }
    var names = [];
    for (var key in found) {
      if (hasOwn(found, key)) {
        names.push(key);
      }
    }
    return names;
  }

  function inferPlatformsFromName(name) {
    var text = String(name || '').toLowerCase();
    var found = {};
    if (/\b(android|apk)\b/.test(text)) {
      found.android = true;
    }
    if (/\b(windows|win32|win64|win)\b/.test(text)) {
      found.windows = true;
    }
    if (/\b(macos|mac|osx|apple)\b/.test(text)) {
      found.macos = true;
    }
    if (/\b(linux)\b/.test(text)) {
      found.linux = true;
    }
    var names = [];
    for (var key in found) {
      if (hasOwn(found, key)) {
        names.push(key);
      }
    }
    return names;
  }

  function parseUploads(html) {
    var uploads = [];
    var seen = {};
    var tagRe = /<div\b([^>]*)>/gi;
    var starts = [];
    var match;
    while ((match = tagRe.exec(html))) {
      var classes = attr(match[1], 'class');
      if (classes && /(^|\s)upload(\s|$)/i.test(classes)) {
        starts.push(match.index);
      }
    }
    for (var i = 0; i < starts.length; i++) {
      var end = i + 1 < starts.length ? starts[i + 1] : html.length;
      var block = html.slice(starts[i], end);
      var id = attr(block, 'data-upload_id') || attr(block, 'data-upload-id');
      if (!id || seen[id]) {
        continue;
      }
      seen[id] = true;
      var name = '';
      var strong = /<strong\b([^>]*)>([\s\S]*?)<\/strong>/i.exec(block);
      if (strong) {
        name = cleanText(attr(strong[1], 'title') || strong[2]);
      }
      if (!name) {
        var nameTag = /<span\b([^>]*)class\s*=\s*("[^"]*\bname\b[^"]*"|'[^']*\bname\b[^']*')[^>]*>([\s\S]*?)<\/span>/i.exec(block);
        if (nameTag) {
          name = cleanText(attr(nameTag[1], 'title') || nameTag[3]);
        }
      }
      if (!name) {
        name = 'upload ' + id;
      }
      var sizeText = '';
      var sizeTag = /<span\b[^>]*class\s*=\s*["'][^"']*\bfile_size\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block);
      if (sizeTag) {
        sizeText = cleanText(sizeTag[1]);
      }
      var platforms = parsePlatforms(block);
      if (platforms.length === 0) {
        platforms = inferPlatformsFromName(name);
      }
      var version = '';
      var versionTag = /<span\b[^>]*class\s*=\s*["'][^"']*\bversion_name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block);
      if (versionTag) {
        version = cleanText(versionTag[1]);
      }
      uploads.push({
        id: String(id),
        order: uploads.length,
        name: name,
        size: parseHumanSize(sizeText),
        sizeText: sizeText,
        platforms: platforms,
        version: version
      });
    }
    return uploads;
  }

  function parsePage(html, page) {
    var gate = detectGate(html);
    if (gate) {
      throwUser(gateMessage(gate));
    }
    var csrf = findCsrf(html);
    if (!csrf) {
      throwUser('页面缺少 CSRF token，可能需要登录/年龄确认，或页面结构已变化。请在扩展设置中填写 Cookie 后重试。');
    }
    var uploads = parseUploads(html);
    if (uploads.length === 0) {
      throwUser('页面没有可下载文件（可能尚未发布、需要购买/登录，或上传已移除）。');
    }
    return {
      title: pageTitle(html) || page.slug,
      csrf: csrf,
      uploads: uploads
    };
  }

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------

  function getFetch(fetchImpl) {
    if (typeof fetchImpl === 'function') {
      return fetchImpl;
    }
    if (typeof fetch === 'function') {
      return fetch;
    }
    throwUser('当前 Gopeed 版本不支持 fetch，请升级 Gopeed。');
  }

  function pageHeaders(settings) {
    var headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    };
    if (settings.cookie) {
      headers.Cookie = settings.cookie;
    }
    return headers;
  }

  async function fetchPage(page, settings, fetchImpl, logger) {
    var doFetch = getFetch(fetchImpl);
    var response;
    try {
      response = await doFetch(page.base, {
        method: 'GET',
        headers: pageHeaders(settings),
        // Keep behavior identical between Gopeed builds with and without a
        // fetch cookie jar: only the explicit user cookie is sent.
        credentials: 'omit',
        redirect: 'follow'
      });
    } catch (error) {
      logger.warn('[itch] page request failed: ' + safeMessage(error));
      throwUser('无法访问 itch.io 页面，请检查网络、代理或 Cookie 设置。');
    }
    if (response.status === 404) {
      throwUser(gateMessage('notfound'));
    }
    if (response.status === 401 || response.status === 403) {
      throwUser('itch.io 拒绝了页面请求（HTTP ' + response.status + '）。可能需要登录 Cookie，或请求被反爬策略拦截。');
    }
    if (response.status === 429) {
      throwUser('请求过于频繁（HTTP 429），请稍后重试。');
    }
    if (!response.ok) {
      throwUser('页面加载失败（HTTP ' + response.status + '），请稍后重试。');
    }
    return await response.text();
  }

  async function resolveSignedUrl(page, uploadId, csrf, settings, fetchImpl, logger) {
    var doFetch = getFetch(fetchImpl);
    var endpoint = page.base + '/file/' + encodeURIComponent(String(uploadId)) +
      '?source=view_game&as_props=1';
    var headers = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: page.base,
      Origin: 'https://' + page.host
    };
    if (settings.cookie) {
      headers.Cookie = settings.cookie;
    }
    var response;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: 'csrf_token=' + encodeURIComponent(csrf),
        credentials: 'omit',
        redirect: 'follow'
      });
    } catch (error) {
      logger.warn('[itch] file endpoint request failed: ' + safeMessage(error));
      throwUser('签名链接获取失败，请稍后重试（网络错误）。');
    }
    if (response.status === 401 || response.status === 403) {
      throwUser('签名链接获取失败（HTTP ' + response.status + '）：可能需要登录 Cookie，或请求被 itch.io 拒绝。');
    }
    if (response.status === 429) {
      throwUser('请求过于频繁（HTTP 429），请稍后重试。');
    }
    if (!response.ok) {
      throwUser('签名链接获取失败（HTTP ' + response.status + '），请稍后重试。');
    }
    var text = await response.text();
    var data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throwUser('签名链接响应不是有效的 JSON，页面结构可能已变化。');
    }
    if (!data) {
      throwUser('签名链接获取失败：响应为空。');
    }
    if (data.lightbox) {
      var lightboxType = data.lightbox_type ? String(data.lightbox_type) : 'verification';
      throwUser('该文件需要额外验证（' + lightboxType + '），扩展不会绕过登录/年龄/隔离检查。');
    }
    if (data.external) {
      throwUser('该上传指向外部站点，扩展只支持 itch.io 托管的文件。');
    }
    if (data.errors) {
      throwUser('签名链接获取失败：itch.io 返回错误，请稍后重试或检查 Cookie。');
    }
    if (!data.url) {
      throwUser('签名链接获取失败：响应中没有下载地址。');
    }
    if (!/^https:\/\//i.test(String(data.url))) {
      throwUser('签名链接不是 HTTPS，已拒绝。');
    }
    return String(data.url);
  }

  function parseContentDisposition(value) {
    if (!value) {
      return '';
    }
    var extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value);
    if (extended) {
      var encoded = extended[2].trim().replace(/^"|"$/g, '');
      try {
        return decodeURIComponent(encoded);
      } catch (error) {
        return encoded;
      }
    }
    var quoted = /filename\s*=\s*"((?:\\.|[^"])*)"/i.exec(value);
    if (quoted) {
      return quoted[1].replace(/\\(.)/g, '$1');
    }
    var plain = /filename\s*=\s*([^;]+)/i.exec(value);
    if (plain) {
      return plain[1].trim().replace(/^"|"$/g, '');
    }
    return '';
  }

  function parseContentRange(value) {
    if (!value) {
      return 0;
    }
    var match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(String(value).trim());
    if (!match || match[1] === '*') {
      return 0;
    }
    var total = parseInt(match[1], 10);
    return isFinite(total) && total > 0 ? total : 0;
  }

  function extensionFromContentType(contentType) {
    var type = String(contentType || '').toLowerCase();
    if (type.indexOf('android.package-archive') >= 0) {
      return '.apk';
    }
    if (type.indexOf('application/zip') >= 0) {
      return '.zip';
    }
    if (type.indexOf('application/x-7z-compressed') >= 0) {
      return '.7z';
    }
    if (type.indexOf('application/x-rar-compressed') >= 0) {
      return '.rar';
    }
    if (type.indexOf('application/x-msdownload') >= 0) {
      return '.exe';
    }
    return '';
  }

  function fallbackFileName(upload, contentType) {
    var name = String(upload.name || ('upload-' + upload.id)).trim();
    if (/\.[a-z0-9]{1,10}$/i.test(name)) {
      return name;
    }
    var lower = name.toLowerCase();
    if (/\bapk\b|launcher/.test(lower)) {
      return name + '.apk';
    }
    if (/\bpack\b/.test(lower) && (upload.platforms || []).indexOf('android') >= 0) {
      return name + '.rpa';
    }
    var ext = extensionFromContentType(contentType);
    return name + (ext || '.bin');
  }

  async function probeFile(signedUrl, fetchImpl, logger) {
    var doFetch = getFetch(fetchImpl);
    var response;
    try {
      response = await doFetch(signedUrl, {
        method: 'GET',
        headers: {
          Range: 'bytes=0-0',
          Accept: '*/*'
        },
        credentials: 'omit',
        redirect: 'follow'
      });
    } catch (error) {
      logger.warn('[itch] file probe failed: ' + safeMessage(error));
      return { name: '', size: 0, contentType: '' };
    }
    var headers = response.headers;
    var disposition = headers && typeof headers.get === 'function'
      ? headers.get('content-disposition')
      : '';
    var contentRange = headers && typeof headers.get === 'function'
      ? headers.get('content-range')
      : '';
    var contentType = headers && typeof headers.get === 'function'
      ? headers.get('content-type') || ''
      : '';
    var contentLength = headers && typeof headers.get === 'function'
      ? parseInt(headers.get('content-length') || '0', 10)
      : 0;
    var name = parseContentDisposition(disposition);
    var size = parseContentRange(contentRange);
    if (!size && response.status === 200 && contentLength > 1) {
      size = contentLength;
    }
    // Drain the tiny ranged body so the connection can be reused. Gopeed's
    // older fetch polyfill resolves after loading the body anyway.
    try {
      if (typeof response.arrayBuffer === 'function') {
        await response.arrayBuffer();
      } else if (typeof response.text === 'function') {
        await response.text();
      }
    } catch (error) {
      // The headers are still useful.
    }
    var rejected = response.status === 401 || response.status === 403;
    if (rejected) {
      logger.warn('[itch] file probe rejected with HTTP ' + response.status);
      return { name: name, size: size, contentType: contentType, status: response.status, rejected: true };
    }
    if (response.status !== 200 && response.status !== 206) {
      logger.warn('[itch] file probe returned HTTP ' + response.status);
      return { name: name, size: size, contentType: contentType, status: response.status, rejected: false };
    }
    if (/text\/html/i.test(contentType) && response.status === 200 && !name) {
      logger.warn('[itch] signed URL returned an HTML page');
      return { name: '', size: 0, contentType: contentType, status: response.status, rejected: false };
    }
    return { name: name, size: size, contentType: contentType, status: response.status, rejected: false };
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  function isArm32(name) {
    var text = String(name || '').toLowerCase();
    return /(arm32|armeabi[-_ ]?v7a|armv7|32[-_ ]?bit|arm[-_ ]?compat)/.test(text);
  }

  function isApkName(name) {
    return /\.apk$/i.test(String(name || ''));
  }

  function isDesktopName(name) {
    return /\.(exe|msi|dmg|pkg|deb|rpm|appimage|zip|7z|rar|tar\.gz|tgz)$/i.test(String(name || ''));
  }

  function hasPlatform(file, name) {
    return file.platforms && file.platforms.indexOf(name) >= 0;
  }

  function isDesktopFile(file) {
    if (isApkName(file.name)) {
      return false;
    }
    var desktopTag = hasPlatform(file, 'windows') || hasPlatform(file, 'macos') || hasPlatform(file, 'linux');
    if (desktopTag) {
      return true;
    }
    if (hasPlatform(file, 'android')) {
      return false;
    }
    return isDesktopName(file.name);
  }

  function fileMatchesPlatform(file, platform) {
    if (platform === 'android') {
      return hasPlatform(file, 'android') || isApkName(file.name);
    }
    if (platform === 'windows') {
      return hasPlatform(file, 'windows') || /\.(exe|msi)$/i.test(file.name);
    }
    if (platform === 'macos') {
      return hasPlatform(file, 'macos') || /\.(dmg|pkg)$/i.test(file.name);
    }
    if (platform === 'linux') {
      return hasPlatform(file, 'linux') || /\.(deb|rpm|appimage)$/i.test(file.name) || /\.tar\.gz$|\.tgz$/i.test(file.name);
    }
    return false;
  }

  function filePreferenceRank(file, preferredPlatform) {
    var arm = isArm32(file.name + ' ' + (file.upload && file.upload.name));
    var apk = isApkName(file.name);
    var desktop = isDesktopFile(file);
    if (preferredPlatform === 'none') {
      return 0;
    }
    if (preferredPlatform === 'android') {
      if (apk && !arm) {
        return 0;
      }
      if (apk && arm) {
        return 1;
      }
      if (hasPlatform(file, 'android')) {
        return 2;
      }
      return 3;
    }
    if (preferredPlatform === 'windows' || preferredPlatform === 'macos' || preferredPlatform === 'linux') {
      if (fileMatchesPlatform(file, preferredPlatform)) {
        return 0;
      }
      if (desktop) {
        return 1;
      }
      if (apk) {
        return 2;
      }
      return 3;
    }
    // auto: APK first, then desktop, then everything else.
    if (apk && !arm) {
      return 0;
    }
    if (apk && arm) {
      return 1;
    }
    if (hasPlatform(file, 'windows')) {
      return 2;
    }
    if (hasPlatform(file, 'macos')) {
      return 3;
    }
    if (hasPlatform(file, 'linux')) {
      return 4;
    }
    if (desktop) {
      return 5;
    }
    return 6;
  }

  function sortFiles(files, preferredPlatform) {
    var preferred = preferredPlatform || 'auto';
    return files.sort(function (left, right) {
      var rankDiff = filePreferenceRank(left, preferred) - filePreferenceRank(right, preferred);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      var leftOrder = left.upload && typeof left.upload.order === 'number' ? left.upload.order : 0;
      var rightOrder = right.upload && typeof right.upload.order === 'number' ? right.upload.order : 0;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      var leftName = String(left.name).toLowerCase();
      var rightName = String(right.name).toLowerCase();
      if (leftName < rightName) {
        return -1;
      }
      if (leftName > rightName) {
        return 1;
      }
      return left.size - right.size;
    });
  }

  function selectFiles(files, platform, includeArm32, preferredPlatform) {
    var preferred = preferredPlatform || 'auto';
    var standardApks = [];
    var armApks = [];
    var others = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (isApkName(file.name)) {
        if (isArm32(file.name + ' ' + (file.upload && file.upload.name))) {
          armApks.push(file);
        } else {
          standardApks.push(file);
        }
      } else {
        others.push(file);
      }
    }

    var selected = [];
    if (platform === 'all') {
      selected = standardApks.concat(armApks, others);
    } else if (platform === 'desktop') {
      var desktops = others.filter(isDesktopFile);
      if (desktops.length > 0) {
        selected = desktops;
      } else if (others.length > 0) {
        selected = others;
      } else {
        selected = standardApks.concat(armApks);
      }
    } else {
      if (includeArm32) {
        selected = standardApks.concat(armApks);
      } else if (standardApks.length > 0) {
        selected = standardApks;
      } else if (others.length > 0) {
        var desktopFallback = others.filter(isDesktopFile);
        if (desktopFallback.length > 0) {
          selected = desktopFallback;
        } else if (armApks.length > 0) {
          throwUser('页面只有 arm32-compat APK。请在扩展设置中开启 includeArm32 后重试。');
        } else {
          selected = others;
        }
      } else if (armApks.length > 0) {
        throwUser('页面只有 arm32-compat APK。请在扩展设置中开启 includeArm32 后重试。');
      }
    }
    return sortFiles(selected, preferred);
  }

  function dedupeFiles(files) {
    var seen = {};
    var result = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var key = String(file.name).toLowerCase() + '|' + String(file.size || 0);
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      result.push(file);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Resolve flow
  // ---------------------------------------------------------------------------

  function uploadMayBeApk(upload) {
    return hasPlatform(upload, 'android') || /\b(android|apk)\b/i.test(String(upload.name || ''));
  }

  function uploadMayBeDesktop(upload) {
    return hasPlatform(upload, 'windows') || hasPlatform(upload, 'macos') ||
      hasPlatform(upload, 'linux') || /\b(windows|win|macos|mac|osx|linux|pc)\b/i.test(String(upload.name || ''));
  }

  function enoughProbed(files, platform, includeArm32) {
    if (platform === 'apk') {
      for (var i = 0; i < files.length; i++) {
        if (isApkName(files[i].name)) {
          var arm = isArm32(files[i].name + ' ' + (files[i].upload && files[i].upload.name));
          if (!arm || includeArm32) {
            return true;
          }
        }
      }
      return false;
    }
    if (platform === 'desktop') {
      for (var j = 0; j < files.length; j++) {
        if (isDesktopFile(files[j])) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  async function probeUploads(page, settings, fetchImpl, logger) {
    var files = [];
    var lastError = null;
    var blockingError = null;
    var probedIds = {};
    var uploads = page.uploads.slice(0, MAX_UPLOADS);
    var preferred = [];
    var fallback = [];
    for (var i = 0; i < uploads.length; i++) {
      var upload = uploads[i];
      var isPreferred = settings.platform === 'all' ||
        (settings.platform === 'apk' && uploadMayBeApk(upload)) ||
        (settings.platform === 'desktop' && uploadMayBeDesktop(upload));
      (isPreferred ? preferred : fallback).push(upload);
    }
    // A name like "LAUNCHER"/"APK" is the cheapest hint; try it before a
    // multi-GB "PACK" upload so the default APK mode needs one probe.
    preferred.sort(function (left, right) {
      function hint(item) {
        return /\b(apk|launcher)\b/i.test(String(item.name || '')) ? 0 : 1;
      }
      return hint(left) - hint(right);
    });

    async function probeList(list) {
      for (var j = 0; j < list.length; j++) {
        var item = list[j];
        if (probedIds[item.id]) {
          continue;
        }
        probedIds[item.id] = true;
        try {
          var signedUrl = await resolveSignedUrl(page, item.id, page.csrf, settings, fetchImpl, logger);
          var info = await probeFile(signedUrl, fetchImpl, logger);
          if (info.rejected) {
            // The 60s signature can expire while a page with many uploads is
            // being probed; acquire a fresh one once before giving up.
            signedUrl = await resolveSignedUrl(page, item.id, page.csrf, settings, fetchImpl, logger);
            info = await probeFile(signedUrl, fetchImpl, logger);
            if (info.rejected) {
              throwUser('签名链接获取失败（HTTP ' + info.status + '）：签名 URL 已过期或被拒绝，请重试。');
            }
          }
          if (/text\/html/i.test(info.contentType) && !info.name) {
            throwUser('该上传返回 HTML 页面，可能是外部链接或需要登录，扩展不支持直接下载。');
          }
          var fileName = sanitizeFilename(info.name || fallbackFileName(item, info.contentType));
          var size = info.size || item.size || 0;
          files.push({
            name: fileName,
            size: size,
            url: signedUrl,
            upload: item,
            platforms: item.platforms
          });
          logger.debug('[itch] probed upload ' + item.id + ' (' + fileName + ')');
        } catch (error) {
          lastError = error;
          var errorMessage = error && error.message ? String(error.message) : '';
          if (/(HTTP 429|HTTP 401|HTTP 403|签名 URL 已过期|网络错误|无法访问)/.test(errorMessage)) {
            blockingError = error;
          }
          logger.warn('[itch] skipped upload ' + item.id + ': ' + safeMessage(error));
        }
      }
    }

    await probeList(preferred);
    // For the default APK mode only sign the Android-looking uploads first.
    // Other files are probed only when no APK was found, which keeps public
    // pages to a few requests instead of one POST per upload.
    if (fallback.length > 0 && !enoughProbed(files, settings.platform, settings.includeArm32)) {
      // Do not silently fall back to another platform when the candidate that
      // might contain the requested APK was skipped because of rate limiting
      // or auth. That would look like "this game has no APK" when it does.
      if (blockingError) {
        throwUser(blockingError.message || '签名链接获取失败，请稍后重试。');
      }
      await probeList(fallback);
    }

    files = dedupeFiles(files);
    if (files.length === 0) {
      if (lastError) {
        throwUser(lastError.message || '没有获取到可下载文件，请稍后重试。');
      }
      throwUser('没有获取到可下载文件，请稍后重试。');
    }
    return files;
  }

  function makeLabels(page, upload) {
    return {
      itchio: '1',
      itchPage: page.base,
      itchUploadId: String(upload.id)
    };
  }

  async function resolveGame(pageUrl, rawSettings, fetchImpl, logger) {
    var settings = readSettings(rawSettings);
    applyFingerprint(settings);
    var page = normalizePageUrl(pageUrl);
    var html = await fetchPage(page, settings, fetchImpl, logger);
    var parsed = parsePage(html, page);
    var probed = await probeUploads({
      base: page.base,
      host: page.host,
      slug: page.slug,
      csrf: parsed.csrf,
      title: parsed.title,
      uploads: parsed.uploads
    }, settings, fetchImpl, logger);
    var selected = selectFiles(probed, settings.platform, settings.includeArm32, settings.preferredPlatform);
    if (selected.length === 0) {
      throwUser('页面没有符合当前 platform 设置的可下载文件。');
    }
    logger.info('[itch] resolved ' + page.slug + ': uploads=' + parsed.uploads.length +
      ' selected=' + selected.length + ' platform=' + settings.platform);
    return {
      name: sanitizeFolderName(parsed.title || page.slug),
      files: selected.map(function (file) {
        return {
          name: file.name,
          size: file.size || 0,
          req: {
            url: file.url,
            labels: makeLabels(page, file.upload)
          }
        };
      })
    };
  }

  // ---------------------------------------------------------------------------
  // Refresh (onStart / onError)
  // ---------------------------------------------------------------------------

  function getTaskRequest(task) {
    return task && task.meta && task.meta.req ? task.meta.req : null;
  }

  function getLabels(request) {
    return request && request.labels ? request.labels : null;
  }

  function setRequestUrl(request, url) {
    if (typeof request.setUrl === 'function') {
      request.setUrl(url);
      return;
    }
    request.url = url;
  }

  async function refreshTask(request, settings, fetchImpl, logger) {
    var labels = getLabels(request);
    if (!labels || labels[LABEL] !== '1') {
      return false;
    }
    var pageUrl = labels.itchPage;
    var uploadId = labels.itchUploadId;
    if (!pageUrl || !uploadId) {
      return false;
    }
    var page = normalizePageUrl(pageUrl);
    var html = await fetchPage(page, settings, fetchImpl, logger);
    var csrf = findCsrf(html);
    if (!csrf) {
      throwUser('刷新签名链接失败：页面缺少 CSRF token，可能需要登录 Cookie。');
    }
    var signedUrl = await resolveSignedUrl(page, uploadId, csrf, settings, fetchImpl, logger);
    setRequestUrl(request, signedUrl);
    return true;
  }

  function errorText(error) {
    if (!error) {
      return '';
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error.message) {
      return String(error.message);
    }
    if (typeof error.Error === 'function') {
      try {
        return String(error.Error());
      } catch (inner) {
        // fall through
      }
    }
    try {
      return String(error);
    } catch (inner) {
      return '';
    }
  }

  function makeLogger() {
    function forward(level) {
      return function (message) {
        try {
          if (typeof gopeed !== 'undefined' && gopeed.logger && typeof gopeed.logger[level] === 'function') {
            gopeed.logger[level](redact(message));
          }
        } catch (error) {
          // Logging must never break a download.
        }
      };
    }
    return {
      debug: forward('debug'),
      info: forward('info'),
      warn: forward('warn'),
      error: forward('error')
    };
  }

  function registerHandlers() {
    if (typeof gopeed === 'undefined' || !gopeed || !gopeed.events) {
      return;
    }
    var logger = makeLogger();

    gopeed.events.onResolve(async function (ctx) {
      var settings = readSettings(gopeed.settings);
      ctx.res = await resolveGame(ctx && ctx.req ? ctx.req.url : '', settings, null, logger);
    });

    gopeed.events.onStart(async function (ctx) {
      var request = getTaskRequest(ctx && ctx.task);
      if (!request) {
        return;
      }
      var settings = readSettings(gopeed.settings);
      try {
        applyFingerprint(settings);
        var refreshed = await refreshTask(request, settings, null, logger);
        if (refreshed) {
          var labels = getLabels(request);
          logger.info('[itch] onStart refreshed signed URL for upload ' + (labels ? labels.itchUploadId : ''));
        }
      } catch (error) {
        logger.warn('[itch] onStart refresh failed: ' + safeMessage(error));
      }
    });

    gopeed.events.onError(async function (ctx) {
      var request = getTaskRequest(ctx && ctx.task);
      if (!request) {
        return;
      }
      var message = errorText(ctx && ctx.error);
      // Refresh only for URL/auth failures. If the error text is unavailable
      // (older goja builds may expose an opaque error object), try a refresh
      // once because a 403 from an expired signed URL is the common case.
      var authOrExpired = /(401|403|forbidden|unauthor|expired)/i.test(message);
      var localFailure = /(no space|permission denied|enospc|eacces|read-only|not found|404|disk\s*(full|error)|write failed)/i.test(message);
      if (message && !authOrExpired && localFailure) {
        return;
      }
      var labels = getLabels(request) || {};
      var count = parseInt(labels.itchRefreshCount || '0', 10);
      if (!isFinite(count) || count < 0) {
        count = 0;
      }
      if (count >= MAX_ERROR_REFRESHES) {
        logger.warn('[itch] onError refresh limit reached for upload ' + (labels.itchUploadId || ''));
        return;
      }
      var settings = readSettings(gopeed.settings);
      try {
        applyFingerprint(settings);
        var refreshed = await refreshTask(request, settings, null, logger);
        if (!refreshed) {
          return;
        }
        if (typeof request.putLabel === 'function') {
          request.putLabel('itchRefreshCount', String(count + 1));
        } else {
          labels.itchRefreshCount = String(count + 1);
        }
        logger.info('[itch] onError refreshed signed URL for upload ' + (labels.itchUploadId || ''));
        if (ctx.task && typeof ctx.task.continue === 'function') {
          ctx.task.continue();
        } else if (ctx.task && typeof ctx.task.Continue === 'function') {
          ctx.task.Continue();
        }
      } catch (error) {
        logger.warn('[itch] onError refresh failed: ' + safeMessage(error));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Test exports / registration
  // ---------------------------------------------------------------------------

  var api = {
    LABEL: LABEL,
    MAX_UPLOADS: MAX_UPLOADS,
    attr: attr,
    cleanText: cleanText,
    decodeHtml: decodeHtml,
    detectGate: detectGate,
    fallbackFileName: fallbackFileName,
    findCsrf: findCsrf,
    isArm32: isArm32,
    isApkName: isApkName,
    normalizePageUrl: normalizePageUrl,
    pageTitle: pageTitle,
    parseContentDisposition: parseContentDisposition,
    parseContentRange: parseContentRange,
    parseHumanSize: parseHumanSize,
    parsePage: parsePage,
    parsePlatforms: parsePlatforms,
    parseUploads: parseUploads,
    readSettings: readSettings,
    redact: redact,
    refreshTask: refreshTask,
    resolveGame: resolveGame,
    sanitizeFilename: sanitizeFilename,
    selectFiles: selectFiles,
    registerHandlers: registerHandlers
  };

  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = api;
  }
  registerHandlers();
})();
