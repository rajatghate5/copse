/**
 * Drive `scroll-harness.html` in real headless Chrome and assert where the
 * message list ends up. Not part of `bun test`: it needs a browser and a dev
 * server, and `bun test` stays self-contained. Run it when touching
 * MessageList's scrolling.
 *
 *   cd packages/web && bunx vite --port 5199
 *   bun run packages/web/dev/scroll-check.ts
 *
 * What it is for: "open a thread at its newest message" depends entirely on
 * measured row heights, so there is nothing to assert without layout - in jsdom
 * every height is zero and every version of this code passes. Run against the
 * first attempt at the fix, these checks caught it opening at scrollTop 0.
 *
 * The wheel events go through CDP's Input domain rather than dispatchEvent,
 * because an untrusted wheel event does not scroll anything - and whether the
 * list can tell a reader's scroll from the layout settling under it is the
 * entire question here.
 */
const PORT = 9333;
const URL_ = 'http://localhost:5199/dev/scroll-harness.html';

const chrome = Bun.spawn([
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/copse-cdp-profile',
  '--no-first-run', '--no-default-browser-check', '--window-size=900,800',
  URL_,
], { stdout: 'ignore', stderr: 'ignore' });

async function target(): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as any[];
      const page = list.find((t) => t.type === 'page' && t.url.includes('scroll-harness'));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await Bun.sleep(250);
  }
  throw new Error('no page target');
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiters = new Map<number, (v: any) => void>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)!(m); waiters.delete(m.id); }
};
const cmd = (method: string, params: any = {}) =>
  new Promise<any>((res) => { const n = ++id; waiters.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

const evaluate = async (expression: string) => {
  const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

const PROBE = `(() => {
  const s = document.querySelector('.stream');
  const el = s && s.firstElementChild;
  if (!el) return { error: 'no list element' };
  return {
    dist: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
    scrollTop: Math.round(el.scrollTop),
    scrollHeight: Math.round(el.scrollHeight),
    clientHeight: Math.round(el.clientHeight),
  };
})()`;

const probe = () => evaluate(PROBE);

async function wheel(deltaY: number, times = 1) {
  const box = await evaluate(`(() => { const r = document.querySelector('.stream').getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  for (let i = 0; i < times; i++) {
    await cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY, pointerType: 'mouse' });
    await Bun.sleep(40);
  }
  await Bun.sleep(350);
}

await cmd('Runtime.enable');
await cmd('Page.enable');
await Bun.sleep(1500);

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

// 1. Opening a thread lands on the newest message.
let p = await probe();
check('opens at the newest message', p.dist <= 6, JSON.stringify(p));

// 2. Switch away...
await evaluate(`window.__switch('b')`);
await Bun.sleep(900);
p = await probe();
check('second thread opens at its newest', p.dist <= 6, JSON.stringify(p));

// 3. ...and back. This is the reported bug.
await evaluate(`window.__switch('a')`);
await Bun.sleep(900);
p = await probe();
check('coming back lands at the newest, not old messages', p.dist <= 6, JSON.stringify(p));

// 4. A real wheel scroll up must stick - the reader is reading.
await wheel(-500, 4);
const up = await probe();
check('a reader scrolling up stays up', up.dist > 150, JSON.stringify(up));

// 5. ...and a message arriving must not yank them to the bottom.
await evaluate(`window.__append('a new message while reading history')`);
await Bun.sleep(700);
const after = await probe();
check('a new message does not yank the reader down', after.dist > 150, JSON.stringify(after));

// 6. Back at the bottom, it follows again.
await wheel(2000, 8);
await Bun.sleep(400);
await evaluate(`window.__append('and another one')`);
await Bun.sleep(700);
const back = await probe();
check('back at the end, it follows new messages', back.dist <= 6, JSON.stringify(back));

chrome.kill();
ws.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
