'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = require('../index.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const PAGE_URL = 'https://testauthor.itch.io/rift-test';

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function page() {
  return { base: PAGE_URL, host: 'testauthor.itch.io', slug: 'rift-test' };
}

function recordingLogger() {
  const lines = [];
  return {
    lines,
    debug(message) {
      lines.push(String(message));
    },
    info(message) {
      lines.push(String(message));
    },
    warn(message) {
      lines.push(String(message));
    },
    error(message) {
      lines.push(String(message));
    }
  };
}

const DOWNLOAD_URLS = {
  '111': 'https://r2.example.test/pc',
  '222': 'https://r2.example.test/mac',
  '333': 'https://r2.example.test/apk',
  '444': 'https://r2.example.test/arm'
};

const PROBES = {
  pc: { name: 'RiftTest-pc.zip', size: 2147483648 },
  mac: { name: 'RiftTest-mac.dmg', size: 1610612736 },
  apk: { name: 'RiftTest.apk', size: 471859200 },
  arm: { name: 'RiftTest-arm32-compat.apk', size: 461373440 }
};

function response(body, init) {
  return new Response(body, init);
}

function makeFetchMock(html) {
  const calls = [];
  async function fetchMock(url, init) {
    const options = init || {};
    calls.push({ url: String(url), init: options });
    const textUrl = String(url);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    const fileMatch = /\/file\/(\d+)\?/.exec(textUrl);
    if (fileMatch) {
      const signed = DOWNLOAD_URLS[fileMatch[1]];
      return response(JSON.stringify({ external: false, url: signed }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (textUrl.startsWith('https://r2.example.test/')) {
      const key = textUrl.split('/').pop();
      const probe = PROBES[key];
      return response(new Uint8Array([0]), {
        status: 206,
        headers: {
          'content-range': `bytes 0-0/${probe.size}`,
          'content-disposition': `attachment; filename="${probe.name}"`,
          'content-type': 'application/octet-stream'
        }
      });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }
  return { calls, fetchMock };
}

test('parses title, CSRF, uploads, sizes and platforms', () => {
  const parsed = api.parsePage(fixture('apk-windows-mac-arm32.html'), page());
  assert.equal(parsed.title, 'Rift Test');
  assert.equal(parsed.csrf, 'TESTCSRF+/=abc');
  assert.equal(parsed.uploads.length, 4);

  const windows = parsed.uploads[0];
  assert.equal(windows.id, '111');
  assert.equal(windows.name, 'Rift Test 1.0 PC');
  assert.equal(windows.size, 2 * 1024 * 1024 * 1024);
  assert.deepEqual(windows.platforms.sort(), ['linux', 'windows']);

  const android = parsed.uploads[2];
  assert.equal(android.id, '333');
  assert.deepEqual(android.platforms, ['android']);
});

test('does not treat devlog wording as a login gate', () => {
  const html = fixture('devlog-login-wording.html');
  assert.equal(api.detectGate(html), '');
  const parsed = api.parsePage(html, page());
  assert.equal(parsed.uploads.length, 1);
  assert.equal(parsed.uploads[0].id, '1001');
});

test('still detects a login page that only says it in text', () => {
  const html = '<html><body><p>You must be logged in to view this page.</p></body></html>';
  assert.equal(api.detectGate(html), 'login');
});

test('rejects missing CSRF token', () => {
  assert.throws(() => api.parsePage(fixture('missing-csrf.html'), page()), /CSRF/);
});

test('rejects login-gated page', () => {
  assert.throws(() => api.parsePage(fixture('login-gated.html'), page()), /登录/);
});

test('rejects age-gated page', () => {
  assert.throws(() => api.parsePage(fixture('age-gated.html'), page()), /年龄/);
});

test('rejects page with no uploads', () => {
  assert.throws(() => api.parsePage(fixture('no-uploads.html'), page()), /没有可下载文件/);
});

test('rejects non-game itch.io URLs', () => {
  assert.throws(() => api.normalizePageUrl('https://itch.io/games/free'), /作者子域名/);
  assert.throws(() => api.normalizePageUrl('https://author.itch.io/game/devlog'), /游戏主页/);
  assert.throws(() => api.normalizePageUrl('https://example.com/game'), /itch\.io/);
  assert.deepEqual(api.normalizePageUrl('https://author.itch.io/game/?ref=1'), {
    base: 'https://author.itch.io/game',
    host: 'author.itch.io',
    slug: 'game'
  });
});

test('parses human-readable sizes', () => {
  assert.equal(api.parseHumanSize('11 GB'), 11 * 1024 * 1024 * 1024);
  assert.equal(api.parseHumanSize('1.5 GB'), Math.round(1.5 * 1024 * 1024 * 1024));
  assert.equal(api.parseHumanSize('450 MB'), 450 * 1024 * 1024);
  assert.equal(api.parseHumanSize('n/a'), 0);
});

test('parses Content-Disposition variants', () => {
  assert.equal(
    api.parseContentDisposition('attachment; filename="game.apk"'),
    'game.apk'
  );
  assert.equal(
    api.parseContentDisposition("attachment; filename*=UTF-8''%E6%B8%B8%E6%88%8F.apk"),
    '游戏.apk'
  );
  assert.equal(
    api.parseContentDisposition('attachment; filename=game.zip'),
    'game.zip'
  );
});

test('selects only the standard APK by default', () => {
  const files = [
    { name: 'RiftTest-pc.zip', size: 10, platforms: ['windows'], upload: { name: 'PC' } },
    { name: 'RiftTest.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID' } },
    { name: 'RiftTest-arm32-compat.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID ARM32-COMPAT' } }
  ];
  const selected = api.selectFiles(files, 'apk', false);
  assert.deepEqual(selected.map((file) => file.name), ['RiftTest.apk']);
});

test('includes arm32 APK when enabled, standard first', () => {
  const files = [
    { name: 'RiftTest-arm32-compat.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID ARM32-COMPAT' } },
    { name: 'RiftTest.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID' } }
  ];
  const selected = api.selectFiles(files, 'apk', true);
  assert.deepEqual(selected.map((file) => file.name), ['RiftTest.apk', 'RiftTest-arm32-compat.apk']);
});

test('all platform lists every upload, with APK first for auto', () => {
  const files = [
    { name: 'RiftTest-pc.zip', size: 10, platforms: ['windows'], upload: { name: 'PC', order: 0 } },
    { name: 'RiftTest-mac.dmg', size: 10, platforms: ['macos'], upload: { name: 'MAC', order: 1 } },
    { name: 'RiftTest.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID', order: 2 } },
    { name: 'RiftTest-arm32-compat.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID ARM32-COMPAT', order: 3 } }
  ];
  const selected = api.selectFiles(files, 'all', false, 'auto');
  assert.deepEqual(selected.map((file) => file.name), [
    'RiftTest.apk',
    'RiftTest-arm32-compat.apk',
    'RiftTest-pc.zip',
    'RiftTest-mac.dmg'
  ]);
});

test('preferredPlatform reorders files and page order can be restored', () => {
  const files = [
    { name: 'RiftTest-pc.zip', size: 10, platforms: ['windows'], upload: { name: 'PC', order: 0 } },
    { name: 'RiftTest-mac.dmg', size: 10, platforms: ['macos'], upload: { name: 'MAC', order: 1 } },
    { name: 'RiftTest.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID', order: 2 } }
  ];
  assert.deepEqual(
    api.selectFiles(files, 'all', false, 'windows').map((file) => file.name),
    ['RiftTest-pc.zip', 'RiftTest-mac.dmg', 'RiftTest.apk']
  );
  assert.deepEqual(
    api.selectFiles(files, 'all', false, 'macos').map((file) => file.name),
    ['RiftTest-mac.dmg', 'RiftTest-pc.zip', 'RiftTest.apk']
  );
  assert.deepEqual(
    api.selectFiles(files, 'all', false, 'none').map((file) => file.name),
    ['RiftTest-pc.zip', 'RiftTest-mac.dmg', 'RiftTest.apk']
  );
});

test('falls back to other files when no APK exists', () => {
  const files = [
    { name: 'RiftTest-arm32-compat.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID ARM32-COMPAT' } },
    { name: 'RiftTest-pc.zip', size: 10, platforms: ['windows'], upload: { name: 'PC' } }
  ];
  const selected = api.selectFiles(files, 'apk', false);
  assert.deepEqual(selected.map((file) => file.name), ['RiftTest-pc.zip']);
});

test('probes desktop fallback when only an arm32 APK exists', async () => {
  const html = fixture('arm32-and-windows.html');
  const logger = recordingLogger();
  const urls = { '601': 'https://r2.example.test/arm-only', '602': 'https://r2.example.test/pc-only' };
  const probes = {
    'arm-only': { name: 'ArmTest-arm32-compat.apk', size: 80 * 1024 * 1024 },
    'pc-only': { name: 'ArmTest-pc.zip', size: 120 * 1024 * 1024 }
  };
  async function fetchMock(url, init) {
    const textUrl = String(url);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    const fileMatch = /\/file\/(\d+)\?/.exec(textUrl);
    if (fileMatch) {
      return response(JSON.stringify({ external: false, url: urls[fileMatch[1]] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    const key = textUrl.split('/').pop();
    const probe = probes[key];
    return response(new Uint8Array([0]), {
      status: 206,
      headers: {
        'content-range': `bytes 0-0/${probe.size}`,
        'content-disposition': `attachment; filename="${probe.name}"`,
        'content-type': 'application/octet-stream'
      }
    });
  }

  const fallback = await api.resolveGame(PAGE_URL, { platform: 'apk', includeArm32: false }, fetchMock, logger);
  assert.deepEqual(fallback.files.map((file) => file.name), ['ArmTest-pc.zip']);

  const arm = await api.resolveGame(PAGE_URL, { platform: 'apk', includeArm32: true }, fetchMock, logger);
  assert.deepEqual(arm.files.map((file) => file.name), ['ArmTest-arm32-compat.apk']);
});

test('reports a clear error when only an arm32 APK exists', () => {
  const files = [
    { name: 'RiftTest-arm32-compat.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID ARM32-COMPAT' } }
  ];
  assert.throws(() => api.selectFiles(files, 'apk', false), /includeArm32/);
});

test('desktop platform prefers desktop files', () => {
  const files = [
    { name: 'RiftTest.apk', size: 10, platforms: ['android'], upload: { name: 'ANDROID' } },
    { name: 'RiftTest-pc.zip', size: 10, platforms: ['windows'], upload: { name: 'PC' } },
    { name: 'RiftTest-mac.dmg', size: 10, platforms: ['macos'], upload: { name: 'MAC' } }
  ];
  const selected = api.selectFiles(files, 'desktop', false);
  assert.deepEqual(selected.map((file) => file.name), ['RiftTest-pc.zip', 'RiftTest-mac.dmg']);
});

test('resolves an APK, POSTs the file endpoint, and returns task labels', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const logger = recordingLogger();
  const result = await api.resolveGame(PAGE_URL, { platform: 'apk', includeArm32: false }, mock.fetchMock, logger);

  assert.equal(result.name, 'Rift Test');
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, 'RiftTest.apk');
  assert.equal(result.files[0].size, 471859200);
  assert.match(result.files[0].req.url, /^https:\/\/r2\.example\.test\//);
  assert.deepEqual(result.files[0].req.labels, {
    itchio: '1',
    itchPage: PAGE_URL,
    itchUploadId: '333'
  });

  const posts = mock.calls.filter((call) => call.init.method === 'POST');
  assert.ok(posts.length >= 2, 'one POST per Android-looking upload');
  for (const post of posts) {
    assert.equal(post.init.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(post.init.headers.Accept, 'application/json');
    assert.equal(post.init.credentials, 'omit');
    assert.match(post.init.body, /^csrf_token=TESTCSRF%2B%2F%3Dabc$/);
    assert.match(post.url, /\/file\/\d+\?source=view_game&as_props=1$/);
  }

  const probeCalls = mock.calls.filter((call) => call.url.startsWith('https://r2.example.test/'));
  assert.ok(probeCalls.length >= 2, 'one range probe per Android-looking upload');
  for (const probe of probeCalls) {
    assert.equal(probe.init.headers.Range, 'bytes=0-0');
  }

  // No URL, CSRF value, or cookie value may appear in the log.
  const log = logger.lines.join('\n');
  assert.doesNotMatch(log, /https?:\/\//);
  assert.doesNotMatch(log, /TESTCSRF/);
});

test('default resolve lists every upload and puts the APK first', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const logger = recordingLogger();
  const result = await api.resolveGame(PAGE_URL, {}, mock.fetchMock, logger);
  assert.deepEqual(result.files.map((file) => file.name), [
    'RiftTest.apk',
    'RiftTest-arm32-compat.apk',
    'RiftTest-pc.zip',
    'RiftTest-mac.dmg'
  ]);
});

test('falls back when the signed URL probe is unavailable', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const logger = recordingLogger();
  const result = await api.resolveGame(PAGE_URL, { platform: 'apk' }, mock.fetchMock, logger);
  assert.equal(result.files[0].name, 'RiftTest.apk');
});

test('onStart refreshes a signed URL using page labels', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const logger = recordingLogger();
  const handlers = {};
  global.gopeed = {
    settings: { platform: 'apk' },
    logger,
    events: {
      onResolve(fn) {
        handlers.onResolve = fn;
      },
      onStart(fn) {
        handlers.onStart = fn;
      },
      onError(fn) {
        handlers.onError = fn;
      }
    }
  };
  api.registerHandlers();
  const originalFetch = global.fetch;
  global.fetch = mock.fetchMock;

  let setUrlValue = '';
  const request = {
    url: 'https://old.example.test/expired',
    labels: { itchio: '1', itchPage: PAGE_URL, itchUploadId: '333' },
    setUrl(value) {
      setUrlValue = value;
      this.url = value;
    }
  };
  await handlers.onStart({ task: { meta: { req: request } } });

  assert.match(setUrlValue, /^https:\/\/r2\.example\.test\//);
  assert.match(request.url, /^https:\/\/r2\.example\.test\//);
  assert.doesNotMatch(logger.lines.join('\n'), /https?:\/\//);

  global.fetch = originalFetch;
  delete global.gopeed;
});

test('onStart writes req.url directly on Gopeed 1.9.x', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const logger = recordingLogger();
  const handlers = {};
  global.gopeed = {
    settings: { platform: 'apk' },
    logger,
    events: {
      onResolve(fn) {
        handlers.onResolve = fn;
      },
      onStart(fn) {
        handlers.onStart = fn;
      },
      onError(fn) {
        handlers.onError = fn;
      }
    }
  };
  api.registerHandlers();
  const originalFetch = global.fetch;
  global.fetch = mock.fetchMock;

  const request = {
    url: 'https://old.example.test/expired',
    labels: { itchio: '1', itchPage: PAGE_URL, itchUploadId: '333' }
  };
  await handlers.onStart({ task: { meta: { req: request } } });
  assert.match(request.url, /^https:\/\/r2\.example\.test\//);

  global.fetch = originalFetch;
  delete global.gopeed;
});

test('onError refreshes once on 403 and continues the task', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const logger = recordingLogger();
  const handlers = {};
  global.gopeed = {
    settings: { platform: 'apk' },
    logger,
    events: {
      onResolve(fn) {
        handlers.onResolve = fn;
      },
      onStart(fn) {
        handlers.onStart = fn;
      },
      onError(fn) {
        handlers.onError = fn;
      }
    }
  };
  api.registerHandlers();
  const originalFetch = global.fetch;
  global.fetch = mock.fetchMock;

  let continued = 0;
  const request = {
    url: 'https://old.example.test/expired',
    labels: { itchio: '1', itchPage: PAGE_URL, itchUploadId: '333' }
  };
  const task = {
    meta: { req: request },
    continue() {
      continued++;
    }
  };
  await handlers.onError({ task, error: new Error('HTTP 403 Forbidden') });

  assert.equal(continued, 1);
  assert.equal(request.labels.itchRefreshCount, '1');
  assert.match(request.url, /^https:\/\/r2\.example\.test\//);
  assert.doesNotMatch(logger.lines.join('\n'), /https?:\/\//);

  global.fetch = originalFetch;
  delete global.gopeed;
});

test('onError does not refresh on unrelated errors or after the limit', async () => {
  const logger = recordingLogger();
  const handlers = {};
  global.gopeed = {
    settings: {},
    logger,
    events: {
      onResolve(fn) {
        handlers.onResolve = fn;
      },
      onStart(fn) {
        handlers.onStart = fn;
      },
      onError(fn) {
        handlers.onError = fn;
      }
    }
  };
  api.registerHandlers();

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('must not be called');
  };

  let continued = 0;
  const request = {
    url: 'https://old.example.test/expired',
    labels: { itchio: '1', itchPage: PAGE_URL, itchUploadId: '333' }
  };
  await handlers.onError({
    task: { meta: { req: request }, continue() { continued++; } },
    error: new Error('disk full')
  });
  assert.equal(fetchCalls, 0);
  assert.equal(continued, 0);

  request.labels.itchRefreshCount = '3';
  await handlers.onError({
    task: { meta: { req: request }, continue() { continued++; } },
    error: new Error('HTTP 403 Forbidden')
  });
  assert.equal(fetchCalls, 0);
  assert.equal(continued, 0);

  global.fetch = originalFetch;
  delete global.gopeed;
});

test('rejects external uploads instead of downloading a landing page', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const logger = recordingLogger();
  async function fetchMock(url, init) {
    const textUrl = String(url);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/\d+\?/.test(textUrl)) {
      return response(JSON.stringify({ external: true, url: 'https://example.com/landing' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }
  await assert.rejects(
    api.resolveGame(PAGE_URL, { platform: 'apk' }, fetchMock, logger),
    /外部站点/
  );
});

test('marks external uploads while parsing', () => {
  const parsed = api.parsePage(fixture('external-uploads.html'), page());
  assert.equal(parsed.uploads.length, 3);
  assert.equal(parsed.uploads[0].external, true);
  assert.equal(parsed.uploads[1].external, true);
  assert.equal(parsed.uploads[2].external, false);
});

test('skips external uploads without requesting their file endpoint', async () => {
  const html = fixture('external-uploads.html');
  const logger = recordingLogger();
  const calls = [];
  async function fetchMock(url, init) {
    const textUrl = String(url);
    calls.push(textUrl);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/777\?/.test(textUrl)) {
      return response(JSON.stringify({ external: false, url: 'https://r2.example.test/walkthrough' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (textUrl === 'https://r2.example.test/walkthrough') {
      return response(new Uint8Array([0]), {
        status: 206,
        headers: {
          'content-range': 'bytes 0-0/784384',
          'content-disposition': 'attachment; filename="Rift Test Walkthrough mod.zip"',
          'content-type': 'application/octet-stream'
        }
      });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }
  const resource = await api.resolveGame(PAGE_URL, { platform: 'all' }, fetchMock, logger);
  assert.equal(resource.files.length, 1);
  assert.equal(resource.files[0].name, 'Rift Test Walkthrough mod.zip');
  assert.equal(calls.some((url) => /\/file\/(555|666)\?/.test(url)), false);
  assert.match(logger.lines.join('\n'), /external=0/);
});

test('explains a page whose uploads are all external', async () => {
  const html = fixture('external-only.html');
  const logger = recordingLogger();
  const calls = [];
  async function fetchMock(url) {
    const textUrl = String(url);
    calls.push(textUrl);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }
  await assert.rejects(
    api.resolveGame(PAGE_URL, { platform: 'all' }, fetchMock, logger),
    /托管在外部站点/
  );
  assert.deepEqual(calls, [PAGE_URL]);
});

test('lists external uploads as text hint files', async () => {
  const html = fixture('external-uploads.html');
  const logger = recordingLogger();
  const calls = [];
  async function fetchMock(url, init) {
    const textUrl = String(url);
    calls.push({ url: textUrl, method: (init && init.method) || 'GET' });
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    const fileMatch = /\/file\/(\d+)\?/.exec(textUrl);
    if (fileMatch) {
      const urls = {
        555: 'https://www.mediafire.com/file/aaa/pc.zip/file',
        666: 'https://mega.nz/file/bbb',
        777: 'https://r2.example.test/walkthrough'
      };
      // The CSRF token must be sent for hint lookups too.
      assert.match(String((init || {}).body || ''), /csrf_token=TESTCSRF/);
      return response(JSON.stringify({ external: fileMatch[1] !== '777', url: urls[fileMatch[1]] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (textUrl === 'https://r2.example.test/walkthrough') {
      return response(new Uint8Array([0]), {
        status: 206,
        headers: {
          'content-range': 'bytes 0-0/784384',
          'content-disposition': 'attachment; filename="Rift Test Walkthrough mod.zip"',
          'content-type': 'application/octet-stream'
        }
      });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }

  const captured = [];
  const restore = withBlobRuntime(async (opener, options) => {
    captured.push({ opener, options });
    return `gblob://hint/${captured.length}`;
  });
  try {
    const resource = await api.resolveGame(PAGE_URL, { platform: 'all' }, fetchMock, logger);
    assert.equal(resource.files.length, 3);
    assert.equal(resource.files[0].name, 'Rift Test Walkthrough mod.zip');
    assert.equal(resource.files[1].name, 'Rift Test 1.0 PC - MIRROR.txt');
    assert.equal(resource.files[2].name, 'Rift Test 1.0 ANDROID - MIRROR.txt');
    assert.equal(resource.files[1].req.url, 'gblob://hint/1');
    assert.equal(resource.files[1].req.labels.itchHint, '1');
    assert.equal(resource.files[1].req.labels.itchExternalUploadId, '555');
    assert.equal(resource.files[1].req.labels.itchHintName, 'Rift Test 1.0 PC - MIRROR');
    assert.equal(captured[0].options.contentType, 'text/plain; charset=utf-8');
    assert.equal(captured[0].options.size, resource.files[1].size);

    const bytes = await drain(captured[0].opener({ offset: 0, end: resource.files[1].size - 1 }));
    const text = Buffer.from(bytes).toString('utf8');
    assert.match(text, /Rift Test 1\.0 PC - MIRROR/);
    assert.match(text, /https:\/\/www\.mediafire\.com\/file\/aaa\/pc\.zip\/file/);

    // A partial range only returns that slice of the text.
    const slice = await drain(captured[0].opener({ offset: 0, end: 3 }));
    assert.equal(Buffer.from(slice).toString('utf8'), 'Rift');
  } finally {
    restore();
  }
});

test('externalHints=false keeps the list to itch.io-hosted files only', async () => {
  const html = fixture('external-uploads.html');
  const logger = recordingLogger();
  const calls = [];
  async function fetchMock(url) {
    const textUrl = String(url);
    calls.push(textUrl);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/777\?/.test(textUrl)) {
      return response(JSON.stringify({ external: false, url: 'https://r2.example.test/walkthrough' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (textUrl === 'https://r2.example.test/walkthrough') {
      return response(new Uint8Array([0]), {
        status: 206,
        headers: {
          'content-range': 'bytes 0-0/784384',
          'content-disposition': 'attachment; filename="Rift Test Walkthrough mod.zip"',
          'content-type': 'application/octet-stream'
        }
      });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }
  const restore = withBlobRuntime(async () => 'gblob://unused');
  try {
    const resource = await api.resolveGame(PAGE_URL, { platform: 'all', externalHints: false }, fetchMock, logger);
    assert.equal(resource.files.length, 1);
    assert.equal(resource.files[0].name, 'Rift Test Walkthrough mod.zip');
    assert.equal(calls.some((url) => /\/file\/(555|666)\?/.test(url)), false);
  } finally {
    restore();
  }
});

test('a page with only external uploads becomes text hint files', async () => {
  const html = fixture('external-only.html');
  const logger = recordingLogger();
  async function fetchMock(url) {
    const textUrl = String(url);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    const fileMatch = /\/file\/(\d+)\?/.exec(textUrl);
    if (fileMatch) {
      return response(JSON.stringify({ external: true, url: `https://www.mediafire.com/file/${fileMatch[1]}/file` }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }
  const restore = withBlobRuntime(async () => 'gblob://hint');
  try {
    const resource = await api.resolveGame(PAGE_URL, { platform: 'all' }, fetchMock, logger);
    assert.equal(resource.files.length, 2);
    assert.deepEqual(resource.files.map((file) => file.name), [
      'Rift Test 1.0 PC - MIRROR.txt',
      'Rift Test 1.0 MAC - MIRROR.txt'
    ]);
  } finally {
    restore();
  }
});

test('onStart rebuilds a hint blob from page labels', async () => {
  const html = fixture('external-only.html');
  const logger = recordingLogger();
  const request = {
    url: 'gblob://stale',
    labels: {
      itchio: '1',
      itchHint: '1',
      itchPage: PAGE_URL,
      itchExternalUploadId: '888',
      itchHintName: 'Rift Test 1.0 PC - MIRROR'
    }
  };
  async function fetchMock(url) {
    const textUrl = String(url);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/888\?/.test(textUrl)) {
      return response(JSON.stringify({ external: true, url: 'https://www.mediafire.com/file/zzz/file' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected URL in test: ${textUrl}`);
  }
  const restore = withBlobRuntime(async () => 'gblob://fresh');
  try {
    const refreshed = await api.refreshTask(request, {}, fetchMock, logger);
    assert.equal(refreshed, true);
    assert.equal(request.url, 'gblob://fresh');
  } finally {
    restore();
  }
});

test('does not silently fall back to desktop when the APK probe is rate limited', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const logger = recordingLogger();
  async function fetchMock(url, init) {
    const textUrl = String(url);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/(?:333|444)\?/.test(textUrl)) {
      return response('slow down', { status: 429 });
    }
    if (/\/file\/\d+\?/.test(textUrl)) {
      return response(JSON.stringify({ external: false, url: 'https://r2.example.test/pc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    const key = textUrl.split('/').pop();
    return response(new Uint8Array([0]), {
      status: 206,
      headers: {
        'content-range': 'bytes 0-0/1000',
        'content-disposition': `attachment; filename="${key}.zip"`,
        'content-type': 'application/octet-stream'
      }
    });
  }
  await assert.rejects(
    api.resolveGame(PAGE_URL, { platform: 'apk' }, fetchMock, logger),
    /429/
  );
});

test('rejects a file endpoint that returns an HTML page', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const logger = recordingLogger();
  async function fetchMock(url, init) {
    const textUrl = String(url);
    if (textUrl === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/\d+\?/.test(textUrl)) {
      return response(JSON.stringify({ external: false, url: 'https://r2.example.test/html' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return response('<!doctype html><title>login</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    });
  }
  await assert.rejects(
    api.resolveGame(PAGE_URL, { platform: 'apk' }, fetchMock, logger),
    /HTML/
  );
});

test('redacts URLs and secrets', () => {
  const redacted = api.redact('GET https://r2.example.test/a?X-Amz-Signature=abc csrf_token=secret cookie: itchio_token=xyz');
  assert.doesNotMatch(redacted, /r2\.example\.test/);
  assert.doesNotMatch(redacted, /secret/);
  assert.doesNotMatch(redacted, /xyz/);
  assert.match(redacted, /<url>/);
});

test('manifest is valid and wires all three events', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'itch-io-downloader');
  assert.ok(manifest.version);
  assert.deepEqual(
    manifest.scripts.map((script) => script.event).sort(),
    ['onError', 'onResolve', 'onStart']
  );
  assert.ok(manifest.scripts[0].match.urls.includes('*://*.itch.io/*'));
  const start = manifest.scripts.find((script) => script.event === 'onStart');
  assert.deepEqual(start.match.labels, ['itchio']);
  const platform = manifest.settings.find((setting) => setting.name === 'platform');
  assert.equal(platform.value, 'all');
  const names = manifest.settings.map((setting) => setting.name);
  assert.ok(names.includes('cookie'));
  assert.ok(names.includes('platform'));
  assert.ok(names.includes('preferredPlatform'));
  assert.ok(names.includes('includeArm32'));
});

// ---------------------------------------------------------------------------
// Resumable blob source (Gopeed 2.x)
// ---------------------------------------------------------------------------

function withBlobRuntime(createObjectURL) {
  const previous = global.gopeed;
  global.gopeed = {
    runtime: {
      blob: { createObjectURL }
    }
  };
  return () => {
    if (previous === undefined) {
      delete global.gopeed;
    } else {
      global.gopeed = previous;
    }
  };
}

async function drain(stream) {
  const reader = stream.getReader();
  const chunks = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    for (let i = 0; i < result.value.length; i++) {
      chunks.push(result.value[i]);
    }
  }
  return Uint8Array.from(chunks);
}

test('resolveGame returns a blob source URL when the runtime supports it', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const captured = [];
  const restore = withBlobRuntime(async (opener, options) => {
    captured.push({ opener, options });
    return 'gblob://resumable/333';
  });
  try {
    const result = await api.resolveGame(PAGE_URL, { platform: 'apk' }, mock.fetchMock, recordingLogger());
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].req.url, 'gblob://resumable/333');
    assert.equal(result.files[0].req.labels.itchBlob, '1');
    assert.equal(result.files[0].req.labels.itchSize, String(471859200));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].options.size, 471859200);
    assert.equal(captured[0].options.range, true);
    assert.equal(typeof captured[0].opener, 'function');
  } finally {
    restore();
  }
});

test('resolveGame falls back to the signed URL when blob creation fails', async () => {
  const html = fixture('apk-windows-mac-arm32.html');
  const mock = makeFetchMock(html);
  const restore = withBlobRuntime(async () => {
    throw new Error('blob runtime unavailable');
  });
  try {
    const result = await api.resolveGame(PAGE_URL, { platform: 'apk' }, mock.fetchMock, recordingLogger());
    assert.match(result.files[0].req.url, /^https:\/\/r2\.example\.test\//);
    assert.equal(result.files[0].req.labels.itchBlob, undefined);
  } finally {
    restore();
  }
});

test('blob opener resumes from the last byte after a truncated response', async () => {
  const payload = Uint8Array.from({ length: 200 }, (_, index) => index % 251);
  const html = fixture('apk-windows-mac-arm32.html');
  const ranges = [];
  let truncatedOnce = false;

  async function fetchMock(url, init) {
    const target = String(url);
    const options = init || {};
    if (target === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/\d+\?/.test(target)) {
      return response(JSON.stringify({ external: false, url: 'https://r2.example.test/apk' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (target === 'https://r2.example.test/apk') {
      const header = options.headers && options.headers.Range;
      ranges.push(header);
      const match = /^bytes=(\d+)-(\d+)$/.exec(header || '');
      if (!match) {
        throw new Error(`missing range header: ${header}`);
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      const slice = payload.slice(start, end + 1);
      if (!truncatedOnce) {
        // Drop the connection halfway through the first response.
        truncatedOnce = true;
        return response(new ReadableStream({
          start(controller) {
            controller.enqueue(slice.slice(0, 50));
            controller.close();
          }
        }), {
          status: 206,
          headers: {
            'content-type': 'application/octet-stream',
            'content-range': `bytes ${start}-${end}/${payload.length}`
          }
        });
      }
      return response(new ReadableStream({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        }
      }), {
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': `bytes ${start}-${end}/${payload.length}`
        }
      });
    }
    throw new Error(`unexpected URL in test: ${target}`);
  }

  api.resetRangeCache();
  const settings = api.readSettings({});
  const opener = api.makeBlobOpener(
    api.normalizePageUrl(PAGE_URL),
    { id: '333' },
    payload.length,
    settings,
    fetchMock,
    recordingLogger()
  );
  const bytes = await drain(opener({ offset: 0, end: -1 }));

  assert.equal(bytes.length, payload.length);
  assert.deepEqual(Array.from(bytes), Array.from(payload));
  assert.deepEqual(ranges, ['bytes=0-199', 'bytes=50-199']);
});

test('blob opener re-signs and retries when the signed URL expires', async () => {
  const payload = Uint8Array.from({ length: 40 }, (_, index) => 255 - index);
  const html = fixture('apk-windows-mac-arm32.html');
  let rejectedOnce = false;
  let signed = 0;

  async function fetchMock(url, init) {
    const target = String(url);
    const options = init || {};
    if (target === PAGE_URL) {
      return response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (/\/file\/\d+\?/.test(target)) {
      signed++;
      return response(JSON.stringify({ external: false, url: 'https://r2.example.test/apk' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (target === 'https://r2.example.test/apk') {
      if (!rejectedOnce) {
        rejectedOnce = true;
        return response('expired', { status: 403 });
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec((options.headers && options.headers.Range) || '');
      const start = Number(match[1]);
      const end = Number(match[2]);
      return response(payload.slice(start, end + 1), { status: 206 });
    }
    throw new Error(`unexpected URL in test: ${target}`);
  }

  api.resetRangeCache();
  const settings = api.readSettings({});
  const opener = api.makeBlobOpener(
    api.normalizePageUrl(PAGE_URL),
    { id: '333' },
    payload.length,
    settings,
    fetchMock,
    recordingLogger()
  );
  const bytes = await drain(opener({ offset: 0, end: -1 }));

  assert.equal(bytes.length, payload.length);
  assert.equal(rejectedOnce, true);
  assert.ok(signed >= 2, 'a fresh signature is requested after HTTP 403');
});
