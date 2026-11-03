#!/usr/bin/env node
/*
 * Gopeed REST API smoke test.
 *
 * This test talks to a running Gopeed instance (desktop, web, or server) and
 * verifies the real extension lifecycle:
 *   install (dev mode) -> resolve -> optionally wait past 60s -> create task
 *   -> optionally wait for completion -> check extension.log for secrets.
 *
 * It is not part of `node --test` because it needs a live Gopeed and network
 * access to itch.io.
 *
 * Usage:
 *   GOPEED_URL=http://127.0.0.1:9999 \
 *   GOPEED_EXT_DIR="$PWD" \
 *   GAME_URL=https://author.itch.io/game \
 *   node test/gopeed-smoke.mjs
 *
 * Optional:
 *   GOPEED_API_TOKEN=...        sent as X-Api-Token
 *   GOPEED_WAIT_EXPIRY=65       wait before creating the task (onStart refresh)
 *   GOPEED_DOWNLOAD=1           wait for the task to finish and check its size
 *   GOPEED_DOWNLOAD_DIR=/path   directory for the created task (default: temp)
 *   GOPEED_CONNECTIONS=1        HTTP connections for the created task
 *   GOPEED_STORAGE=/path        Gopeed storage dir, to check logs/extension.log
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = (process.env.GOPEED_URL || 'http://127.0.0.1:9999').replace(/\/+$/, '');
const extDir = path.resolve(process.env.GOPEED_EXT_DIR || process.cwd());
const gameUrl = process.env.GAME_URL || '';
if (!gameUrl) {
  console.error('GAME_URL is required, e.g. https://author.itch.io/game');
  process.exit(2);
}
const apiToken = process.env.GOPEED_API_TOKEN || '';
const waitExpiry = Number(process.env.GOPEED_WAIT_EXPIRY || 0);
const doDownload = process.env.GOPEED_DOWNLOAD === '1';
const downloadDir = path.resolve(process.env.GOPEED_DOWNLOAD_DIR || path.join(os.tmpdir(), 'gopeed-itch-smoke'));
const connections = Number(process.env.GOPEED_CONNECTIONS || 1);
const storageDir = process.env.GOPEED_STORAGE || '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers() {
  const result = { 'Content-Type': 'application/json' };
  if (apiToken) {
    result['X-Api-Token'] = apiToken;
  }
  return result;
}

async function request(method, pathname, body) {
  const response = await fetch(base + pathname, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${method} ${pathname} returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok || (json && json.code !== 0)) {
    throw new Error(`${method} ${pathname} failed (HTTP ${response.status}): ${json && json.msg ? json.msg : text.slice(0, 200)}`);
  }
  return json.data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log(`Gopeed: ${base}`);
  console.log(`Extension: ${extDir}`);
  console.log(`Game: ${gameUrl}`);

  const info = await request('GET', '/api/v1/info');
  console.log(`Gopeed version: ${info.version} (${info.os}/${info.arch})`);

  const identity = await request('POST', '/api/v1/extensions', { devMode: true, url: extDir });
  console.log(`Installed: ${identity}`);
  // Make the smoke test deterministic regardless of previously saved settings.
  await request('PUT', `/api/v1/extensions/${encodeURIComponent(identity)}/settings`, {
    settings: { platform: 'all', preferredPlatform: 'auto', includeArm32: false }
  });

  const resolved = await request('POST', '/api/v1/resolve', { req: { url: gameUrl } });
  assert(resolved && resolved.res && Array.isArray(resolved.res.files), 'resolve returned no resource');
  const files = resolved.res.files;
  assert(files.length > 0, 'resolve returned an empty file list');
  for (const file of files) {
    assert(typeof file.name === 'string' && file.name.length > 0, 'file name missing');
    assert(file.req && typeof file.req.url === 'string', `file ${file.name} has no request URL`);
    assert(file.req.labels && file.req.labels.itchio === '1', `file ${file.name} is missing the itchio label`);
  }
  const apk = files.find((file) => /\.apk$/i.test(file.name));
  assert(apk, 'no APK in the default resolve result');
  console.log(`Resolved ${files.length} file(s):`);
  for (const file of files) {
    console.log(`  - ${file.name} (${file.size} bytes)`);
  }

  if (waitExpiry > 0) {
    console.log(`Waiting ${waitExpiry}s before creating the task (signed URL should expire)...`);
    await sleep(waitExpiry * 1000);
  }

  // Create one task only: the APK when present, otherwise the first file.
  // This keeps the smoke test from creating multi-GB desktop downloads.
  const toCreate = apk ? [apk] : [files[0]];
  fs.mkdirSync(downloadDir, { recursive: true });
  const payload = {
    reqs: toCreate.map((file) => ({
      req: file.req,
      opts: {
        name: file.name,
        path: downloadDir,
        extra: { connections }
      }
    }))
  };
  const taskIds = await request('POST', '/api/v1/tasks/batch', payload);
  assert(Array.isArray(taskIds) && taskIds.length === toCreate.length, 'batch create returned unexpected task ids');
  console.log(`Created task(s): ${taskIds.join(', ')}`);

  if (!doDownload) {
    console.log('GOPEED_DOWNLOAD is not set; task creation only. Set GOPEED_DOWNLOAD=1 to wait for completion.');
    return;
  }

  const deadline = Date.now() + 60 * 60 * 1000;
  for (const taskId of taskIds) {
    let task;
    do {
      await sleep(2000);
      task = await request('GET', `/api/v1/tasks/${taskId}`);
      const total = task.size || (task.meta && task.meta.res && task.meta.res.size) || 0;
      const downloaded = task.progress ? task.progress.downloaded : 0;
      process.stdout.write(`\r${task.status} ${downloaded}/${total} bytes`);
      if (Date.now() > deadline) {
        throw new Error(`timeout waiting for task ${taskId}`);
      }
    } while (task.status !== 'done' && task.status !== 'error');
    process.stdout.write('\n');
    assert(task.status === 'done', `task ${taskId} ended with status ${task.status}`);
    const file = toCreate.find((entry) => entry.name === task.name) || toCreate[0];
    const target = path.join(downloadDir, file.name);
    assert(fs.existsSync(target), `downloaded file not found: ${target}`);
    const size = fs.statSync(target).size;
    assert(size === file.size, `size mismatch for ${file.name}: got ${size}, expected ${file.size}`);
    console.log(`Downloaded and verified: ${target} (${size} bytes)`);
  }
}

async function checkLogs() {
  if (!storageDir) {
    return;
  }
  const logPath = path.join(storageDir, 'logs', 'extension.log');
  if (!fs.existsSync(logPath)) {
    console.log(`Log check skipped: ${logPath} not found`);
    return;
  }
  const log = fs.readFileSync(logPath, 'utf8');
  const leaks = [
    /X-Amz-Signature/i,
    /X-Amz-Credential/i,
    /csrf_token\s*=/i,
    /itchio_token/i,
    /r2\.cloudflarestorage\.com/i,
    /cookie\s*:/i
  ];
  for (const pattern of leaks) {
    assert(!pattern.test(log), `extension.log appears to contain a secret: ${pattern}`);
  }
  console.log(`Log check passed: ${logPath} has no URL, CSRF, Cookie, or signed-URL parameters.`);
}

try {
  await main();
  await checkLogs();
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  process.exitCode = 1;
}
