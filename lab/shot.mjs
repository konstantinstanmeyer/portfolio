#!/usr/bin/env node
// Headless WebGL screenshot via the Chrome DevTools Protocol.
//
// Usage:
//   node shot.mjs <attempt> <out.png> [query] [width] [height]
//   node shot.mjs --url <full-url> <out.png> [width] [height]   (any page, e.g. the Next app)
//
// Examples:
//   node shot.mjs segmented shots/segmented-views.png "sheet=views&t=0"
//   node shot.mjs segmented shots/segmented-motion.png "sheet=motion&view=side" 1600 700
//   node shot.mjs --url http://localhost:3000 shots/app.png 1440 900
//
// Harness pages set document.title to READY or ERROR; for --url pages we wait
// for load + a short settle delay. Console errors and page errors are printed.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
let url, out, W, H, isHarness = true;
if (argv[0] === '--url') {
  isHarness = false;
  [, url, out] = argv;
  W = +(argv[3] || 1440); H = +(argv[4] || 900);
} else {
  const [a, o, query = 'sheet=views'] = argv;
  if (!a || !o) { console.error('usage: node shot.mjs <attempt> <out.png> [query] [w] [h]'); process.exit(2); }
  const port = process.env.LAB_PORT || 8765;
  url = `http://127.0.0.1:${port}/harness.html?a=${encodeURIComponent(a)}&${query}`;
  out = o;
  W = +(argv[3] || 1600); H = +(argv[4] || 900);
}
const SETTLE_MS = +(process.env.SETTLE_MS || (isHarness ? 0 : 2500));

const profile = mkdtempSync(join(tmpdir(), 'labchrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars',
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

let done = false;
function cleanup(code) {
  if (done) return; done = true;
  try { chrome.kill('SIGKILL'); } catch {}
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 200);
}
const hardTimer = setTimeout(() => { console.error('TIMEOUT after 60s'); cleanup(1); }, 60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function devtoolsPort() {
  const f = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) { if (existsSync(f)) { const p = readFileSync(f, 'utf8').split('\n')[0]; if (p) return p; } await sleep(50); }
  throw new Error('Chrome did not start (no DevToolsActivePort)');
}

try {
  const port = await devtoolsPort();
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {}
    await sleep(50);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(`console.${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    else if (msg.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
  let title = '';
  for (let i = 0; i < 400; i++) {
    title = await evalJs('document.title');
    const state = await evalJs('document.readyState');
    if (isHarness && (title === 'READY' || title === 'ERROR')) break;
    if (!isHarness && state === 'complete') break;
    await sleep(50);
  }
  if (SETTLE_MS) await sleep(SETTLE_MS);
  // two rAFs so the last frame is composited
  await evalJs('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
  await send('Runtime.evaluate', { expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))', awaitPromise: true });
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  const err = isHarness ? await evalJs("document.getElementById('err')?.textContent || ''") : '';
  if (err) console.log('PAGE ERROR: ' + err.slice(0, 3000));
  for (const l of logs.slice(0, 20)) console.log(l.slice(0, 500));
  console.log(`title=${title} saved=${out} (${W}x${H})`);
  clearTimeout(hardTimer);
  cleanup(err || title === 'ERROR' ? 1 : 0);
} catch (e) {
  console.error('shot failed:', e.message);
  cleanup(1);
}
