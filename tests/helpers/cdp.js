// tests/helpers/cdp.js — a minimal Chrome DevTools Protocol client, for the browser tests
//
// Provides
//   connect(port = 9222, { fresh }) → { send, evaluate, screenshot, sleep, on, close }
//     fresh (default): a brand-new tab, so nothing (a frozen or hidden state) carries over
//
// Uses
//   Node's built-in fetch and WebSocket (Node 22 or newer) and a Chrome started with
//   --remote-debugging-port (tests/run.js starts one for the browser tests)
const fs = require('fs');

async function connect(port = 9222, { fresh = true } = {}) {
  // A brand-new tab by default, so nothing (e.g. a frozen or hidden state) carries over between runs
  let page;
  if (fresh) {
    page = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  } else {
    const list = await (await fetch(`http://localhost:${port}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const screenshot = async (file, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { scale: 1, ...clip } } : {}) });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const close = () => {
    ws.close();
    if (fresh) fetch(`http://localhost:${port}/json/close/${page.id}`).catch(() => {});
  };
  return { send, evaluate, screenshot, sleep, on: (fn) => listeners.push(fn), close };
}

module.exports = { connect };
