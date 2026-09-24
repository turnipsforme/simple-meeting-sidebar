const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const { readFileSync } = require('node:fs');
let NotificationMotion, waitForNotificationExit, RefreshStatus;

test.before(async () => {
  const result = await build({
    stdin: { contents: 'export { NotificationMotion, waitForNotificationExit } from "./src/notification-motion"; export { RefreshStatus } from "./src/refresh-status";', resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', write: false,
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  ({ NotificationMotion, waitForNotificationExit, RefreshStatus } = module.exports);
});

function transition(transitionProperty) {
  let finish, cancel;
  return { transitionProperty, playState: 'running',
    finished: new Promise((resolve, reject) => { finish = resolve; cancel = reject; }),
    finish() { this.playState = 'finished'; finish(); },
    cancel() { this.playState = 'idle'; cancel(new Error('Transition retargeted')); } };
}

test('exit waits for both CSS properties and any replacement after interruption', async t => {
  const f = fixture(t);
  const row = f.rows.get('a');
  const fade = transition('opacity'), travel = transition('translate');
  // Unrelated theme animations and vertical movement must not block dismissal.
  let animations = [fade, travel, { playState: 'running', finished: new Promise(() => {}) },
    transition('color')];
  row.getAnimations = () => animations;
  let done = false;
  const pending = waitForNotificationExit(row).then(() => { done = true; });
  travel.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false, 'space is held while opacity is still transitioning');
  const replacement = transition('opacity');
  animations = [replacement];
  fade.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false, 'a changed transition must finish before space is released');
  replacement.finish();
  await pending;
  assert.equal(done, true);
});

test('detached exits and disabled transitions settle without timers or leftover effects', async t => {
  const f = fixture(t);
  const row = f.rows.get('a');
  await waitForNotificationExit(row);
  const fade = transition('opacity');
  row.getAnimations = () => [fade];
  const pending = waitForNotificationExit(row);
  row.remove();
  fade.cancel();
  await pending;
  assert.equal(f.frames.size, 0);
  assert.equal(f.records.length, 0);
});

test('exit styles keep the row in flow and compose with vertical movement', t => {
  const dom = new JSDOM('<div class="wcm-notifications"><div class="wcm-notification"></div></div>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement('style');
  style.textContent = readFileSync('styles.css', 'utf8');
  doc.head.append(style);
  const row = doc.querySelector('.wcm-notification');
  row.style.transform = 'translateY(20px)';
  const before = dom.window.getComputedStyle(row);
  row.classList.add('is-dismissing');
  const during = dom.window.getComputedStyle(row);
  assert.equal(during.opacity, '0');
  assert.equal(during.translate, '-8px 0');
  assert.equal(during.transform, 'translateY(20px)', 'closing does not replace the vertical transform');
  assert.equal(during.visibility, 'visible', 'only opacity fades before completion');
  for (const property of ['display', 'height', 'minHeight', 'padding', 'margin']) {
    assert.equal(during[property], before[property], `${property} stays in flow through the exit`);
  }
  assert.equal(during.transition, 'opacity 200ms var(--wcm-notification-fade-ease), translate 200ms var(--wcm-notification-ease)');
  // JSDOM does not evaluate media preferences, so apply the actual reduced rules.
  const reduced = doc.createElement('style');
  reduced.textContent = [...style.sheet.cssRules]
    .filter(rule => rule.media?.mediaText === '(prefers-reduced-motion: reduce)')
    .flatMap(rule => [...rule.cssRules].filter(child => child.selectorText).map(child => child.cssText)).join('\n');
  doc.head.append(reduced);
  assert.equal(dom.window.getComputedStyle(row).translate, 'none');
  assert.equal(dom.window.getComputedStyle(row).transition, 'opacity 100ms var(--wcm-notification-fade-ease)');
  row.classList.add('is-dismissed');
  assert.equal(dom.window.getComputedStyle(row).visibility, 'hidden');
});

function fixture(t) {
  const dom = new JSDOM('<div id="rows"></div>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const win = dom.window;
  win.matchMedia = () => ({ matches: false });
  const frames = new Map();
  let nextFrame = 0;
  win.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  win.cancelAnimationFrame = key => frames.delete(key);
  const container = win.document.querySelector('#rows');
  container.getBoundingClientRect = () => ({ top: 100 });
  const records = [];
  const rows = new Map();
  for (const [index, key] of ['a', 'b', 'c'].entries()) {
    const row = win.document.createElement('div');
    row.top = index * 48;
    row.getBoundingClientRect = () => ({ top: 100 + row.top });
    row.getAnimations = () => [];
    row.animate = (keyframes, options) => {
      let finish;
      const animation = { canceled: false, finished: new Promise(resolve => { finish = resolve; }),
        cancel() { this.canceled = true; finish(); } };
      records.push({ row, keyframes, options, animation, finish });
      return animation;
    };
    container.appendChild(row);
    rows.set(key, row);
  }
  const motion = new NotificationMotion();
  t.after(() => motion.destroy());
  motion.update(container, rows);
  const flush = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn()); };
  const remove = key => { rows.get(key).remove(); rows.delete(key); [...rows.values()].forEach((row, i) => { row.top = i * 48; }); };
  return { dom, win, container, motion, rows, records, frames, flush, remove };
}

test('dismissal animates surviving rows once and finishes without a transform override', async t => {
  const f = fixture(t);
  f.motion.prepareDismissal('a');
  f.motion.update(f.container, f.rows); // Busy update must not consume the snapshot.
  assert.equal(f.frames.size, 0);
  f.remove('a');
  f.motion.update(f.container, f.rows);
  assert.equal(f.records.length, 0, 'reads and writes are scheduled after reconciliation');
  f.flush();
  assert.equal(f.records.length, 2);
  for (const record of f.records) {
    assert.deepEqual(record.keyframes, [{ transform: 'translateY(48px)' }, { transform: 'translateY(0px)' }]);
    assert.equal(record.options.duration, 200);
    assert.equal(record.options.easing, 'cubic-bezier(0.77, 0, 0.175, 1)');
    record.finish();
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.records.every(record => record.animation.canceled));
  f.motion.update(f.container, f.rows); f.flush();
  assert.equal(f.records.length, 2, 'unrelated renders do not replay movement');
});

test('editor geometry is read only through requestMeasure, with separate writes', t => {
  const f = fixture(t);
  let request;
  const editor = { requestMeasure(value) { request = value; } };
  f.motion.update(f.container, f.rows, editor);
  f.motion.prepareDismissal('b');
  f.remove('b');
  f.motion.update(f.container, f.rows, editor);
  assert.equal(f.records.length, 0);
  const measured = request.read();
  assert.equal(f.records.length, 0);
  request.write(measured);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].row, f.rows.get('c'));
});

test('rapid dismissal retargets current visual positions and retires old effects', async t => {
  const f = fixture(t);
  f.motion.prepareDismissal('a'); f.remove('a'); f.motion.update(f.container, f.rows); f.flush();
  const firstEffects = [...f.records];
  f.rows.get('c').top = 70; // Intermediate visible position, not its target of 48.
  f.motion.prepareDismissal('b');
  assert.ok(firstEffects.every(record => record.animation.canceled));
  f.remove('b'); f.motion.update(f.container, f.rows); f.flush();
  const newest = f.records.at(-1);
  assert.equal(newest.keyframes[0].transform, 'translateY(70px)');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(newest.animation.canceled, false, 'old completion cannot cancel the replacement');
});

test('keyboard changes, reduced motion, detached views and empty lists start no movement', t => {
  const f = fixture(t);
  f.remove('a'); f.motion.update(f.container, f.rows); f.flush();
  assert.equal(f.records.length, 0);
  f.win.matchMedia = () => ({ matches: true });
  f.motion.prepareDismissal('b'); f.remove('b'); f.motion.update(f.container, f.rows); f.flush();
  assert.equal(f.records.length, 0);
  f.win.matchMedia = () => ({ matches: false });
  f.motion.prepareDismissal('c'); f.remove('c'); f.motion.update(f.container, f.rows);
  f.container.remove(); f.flush();
  assert.equal(f.records.length, 0);
});

test('destroy cancels queued reads and ignores stale editor callbacks', t => {
  const f = fixture(t);
  let request;
  const editor = { requestMeasure(value) { request = value; } };
  f.motion.update(f.container, f.rows, editor);
  f.motion.prepareDismissal('a'); f.remove('a'); f.motion.update(f.container, f.rows, editor);
  f.motion.destroy();
  request.write(request.read());
  assert.equal(f.records.length, 0);
});

test('refresh feedback uses no visible label and pulses the handle exactly three times', async t => {
  const f = fixture(t);
  f.win.HTMLElement.prototype.createDiv = function(options) {
    const child = this.ownerDocument.createElement('div');
    child.className = options.cls || '';
    for (const [key, value] of Object.entries(options.attr || {})) child.setAttribute(key, value);
    this.appendChild(child);
    return child;
  };
  const indicator = f.rows.get('a');
  const status = new RefreshStatus(f.container, indicator);
  t.after(() => status.dispose());
  assert.equal(status.element.className, 'wcm-status-announcement');
  assert.equal(f.container.querySelector('.wcm-refreshing'), null);
  assert.equal(f.container.querySelector('.wcm-refreshing-label'), null);
  status.update(false, false);
  status.update(true, true);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].options.iterations, 3);
  assert.equal(f.records[0].options.duration, 600);
  assert.equal(status.element.textContent, 'Refreshing calendars…');
  const textNode = status.element.firstChild;
  status.update(true, true);
  assert.equal(status.element.firstChild, textNode);
  assert.equal(f.records.length, 1, 'unrelated renders do not restart the pulses');
  status.update(false, true);
  assert.equal(status.element.textContent, '');
  assert.equal(f.records[0].animation.canceled, false, 'fast refreshes still finish their brief feedback');
  status.update(true, true);
  assert.equal(f.records[0].animation.canceled, true);
  assert.equal(f.records.length, 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.records[1].animation.canceled, false, 'old completion cannot cancel a new pulse');
  status.update(false, true);
  status.update(true, false);
  assert.equal(f.records[1].animation.canceled, true);
  assert.equal(f.records.length, 2, 'keyboard refresh shows a steady highlight');
  status.update(false, false);
  f.win.matchMedia = () => ({ matches: true });
  status.update(true, true);
  assert.equal(f.records.length, 2, 'reduced motion does not repeatedly flash');
  assert.equal(indicator.classList.contains('is-refreshing'), true);
  status.dispose();
  assert.equal(indicator.classList.contains('is-refreshing'), false);
  const mountedWhileLoading = new RefreshStatus(f.container, indicator);
  mountedWhileLoading.update(true, true);
  assert.equal(f.records.length, 2, 'mounting during refresh does not start a new pulse');
  mountedWhileLoading.dispose();
});
