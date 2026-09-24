const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const repo = createRequire(root + '/package.json');
const { JSDOM } = require('jsdom');
const { EditorState, StateField } = repo('@codemirror/state');
const { EditorView, Decoration, WidgetType } = repo('@codemirror/view');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const win = dom.window;
for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Node', 'Window', 'Document'])
  Object.defineProperty(globalThis, key, { value: key === 'window' ? win : win[key], configurable: true });
globalThis.getComputedStyle = win.getComputedStyle.bind(win);
Object.defineProperty(win.HTMLElement.prototype, 'win', { get() { return win; } });
Object.defineProperty(win.HTMLElement.prototype, 'doc', { get() { return this.ownerDocument; } });
function create(tag, options = {}) {
  const element = win.document.createElement(tag);
  if (options.cls) element.className = options.cls;
  if (options.text) element.textContent = options.text;
  for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
  if (this.appendChild) this.appendChild(element);
  return element;
}
for (const proto of [win.HTMLElement.prototype, win.Document.prototype]) {
  proto.createDiv = function(options) { return create.call(this, 'div', options); };
  proto.createSpan = function(options) { return create.call(this, 'span', options); };
  proto.createEl = function(tag, options) { return create.call(this, tag, options); };
  proto.empty = function() { this.replaceChildren(); };
  proto.addClass = function(...names) { this.classList.add(...names); };
  proto.setAttr = function(key, value) { this.setAttribute(key, value); };
}
test('notification containers stay detached until mounted in the editor or reading footer', async (t) => {
  let notifications;
  let editor;
  t.after(() => {
    editor?.destroy();
    notifications?.unload();
    dom.window.close();
  });
  // Obsidian's Node.createDiv sets parent=this. Calling it on Document must throw,
  // not silently return a detached node as the original fixture incorrectly did.
  assert.throws(() => win.document.createDiv(), { name: 'HierarchyRequestError' });
  const result = await repo('esbuild').build({
    stdin: { contents: 'export { MeetingNotifications } from "./src/meeting-notifications"; export { renderEventRow, SimpleMeetingSidebarView } from "./src/view"; export { MarkdownView, editorInfoField, Platform } from "obsidian";', resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['@codemirror/state', '@codemirror/view'],
    plugins: [{ name: 'obsidian-fixture', setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
        import { StateField } from '@codemirror/state';
        export class Component {
          callbacks = [];
          register(fn) { this.callbacks.push(fn); }
          registerEvent() {}
          unload() { this.onunload(); this.callbacks.forEach(fn => fn()); }
        }
        export class MarkdownView { getMode() { return 'preview'; } }
        export const Platform = {isMobile: true}; export class ItemView { constructor(leaf) { this.containerEl=leaf.containerEl; this.contentEl=leaf.contentEl; } registerDomEvent() {} }
        export class Modal {}
        export class TFile {}
        export function setIcon(el, icon) { el.dataset.icon = icon; }
        export const editorInfoField = StateField.define({ create: () => ({file: {path: 'Today.md'}}), update: v => v });
      ` }));
    } }],
  });
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(repo, compiled, compiled.exports);
  const { MeetingNotifications, renderEventRow, SimpleMeetingSidebarView, Platform, MarkdownView, editorInfoField } = compiled.exports;
  const event = { key: '1', title: 'Meeting with John', start: new Date(2026,8,20,10,30).toISOString(), allDay: false };
  let events = [event];
  const busy = new Set();
  let pendingSave;
  let subscriber;
  const contentEl = create.call(win.document.body, 'div');
  const preview = create.call(contentEl, 'div', {cls: 'markdown-preview-view'});
  const sizer = create.call(preview, 'div', {cls: 'markdown-preview-sizer'});
  const view = new MarkdownView();
  Object.assign(view, { file: {path: 'Today.md'}, contentEl });
  const plugin = {
    settings: { monochromeNotifications: false },
    app: {workspace: {on() {}, getLeavesOfType() { return [{view}]; }}, vault: { getAbstractFileByPath() { return null; } }},
    getNotificationEvents() { return events; }, getTodayEvents() { return events; },
    getCalendarStatus() { return 'Calendar updated Sep 23, 10:00.'; }, getLastError() { return 'Internal error must not appear on mobile'; },
    isRefreshing() { return false; }, shouldAnimateRefreshStatus() { return false; }, getCachedDate() { return '2026-09-23'; },
    getPillOffset() { return 0; }, async refreshToday() {},
    isEventBusy(key) { return busy.has(key); },
    subscribe(fn) { subscriber = fn; return () => { subscriber = undefined; }; },
    renderViews() { subscriber?.(); },
    async runEventAction(event, action) {
      busy.add(event.key); subscriber();
      try { await action(); } finally { busy.delete(event.key); subscriber(); }
    },
    async dismissEvent(event, notificationOnly) {
      assert.equal(notificationOnly, true);
      if (pendingSave) await pendingSave;
      event.notificationHidden = true; subscriber();
    },
    async addEventAsTask() {}, async createEventMeeting() {},
  };
  notifications = new MeetingNotifications(plugin, { getTodayPath() { return 'Today.md'; } });
  notifications.onload();
  let banner = preview.querySelector('.wcm-notifications');
  assert.equal(banner.previousElementSibling, sizer);
  assert.deepEqual([...banner.querySelectorAll('button')].map(el => el.dataset.icon), ['list-todo', 'file-plus-2', 'x']);
  assert.equal(banner.querySelectorAll('.wcm-notification-secondary').length, 2);
  assert.ok(!banner.querySelector('[data-icon=x]').classList.contains('wcm-notification-secondary'));
  assert.equal(banner.querySelector('.wcm-notification-content').textContent, '10:30amMeeting with John');
  assert.equal(banner.querySelector('.wcm-event-title').title, event.title);
  assert.equal(banner.querySelector('[data-icon=x]').getAttribute('aria-label'), 'Dismiss notification');
  const influx = create.call(preview, 'div', { cls: 'influx-preview-wrapper' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(banner.nextElementSibling, influx, 'late Influx mount stays immediately below notifications');
  banner.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(banner.nextElementSibling, influx, 'reading rerenders reattach the footer');
  class InfluxWidget extends WidgetType { toDOM() { return win.document.createElement('obsidian-influx-element'); } }
  const influxField = StateField.define({
    create: state => Decoration.set([Decoration.widget({widget: new InfluxWidget(), block:true, side:1}).range(state.doc.length)]),
    update: (v,tr) => v.map(tr.changes), provide: field => EditorView.decorations.from(field),
  });
  editor = new EditorView({ parent: win.document.body, state: EditorState.create({doc:'# Today', extensions:[editorInfoField, notifications.extension, influxField]}) });
  const editorBanner = editor.dom.querySelector('.wcm-notifications');
  const originalRow = banner.querySelector('.wcm-notification');
  const originalEditorRow = editorBanner.querySelector('.wcm-notification');
  assert.ok(editorBanner, 'widget creation must not fail inside CodeMirror');
  assert.equal(editor.state.doc.toString(), '# Today', 'notifications never change the note text');
  assert.equal(editorBanner.nextElementSibling.tagName, 'OBSIDIAN-INFLUX-ELEMENT');
  assert.equal(editorBanner.previousElementSibling.className, 'cm-line');
  plugin.settings.monochromeNotifications = true;
  subscriber();
  banner = preview.querySelector('.wcm-notifications');
  assert.ok(banner.classList.contains('wcm-notifications-monochrome'), 'style changes update reading mode immediately');
  assert.ok(editor.dom.querySelector('.wcm-notifications-monochrome'), 'style changes update the existing editor');
  assert.equal(banner.querySelector('.wcm-notification'), originalRow, 'theme updates retain rows instead of replaying entry');
  assert.equal(editor.dom.querySelector('.wcm-notification'), originalEditorRow, 'editor updates retain rows too');
  assert.equal(editor.state.doc.toString(), '# Today');
  assert.equal(banner.nextElementSibling, influx, 'changing the style keeps the existing footer placement');
  plugin.settings.monochromeNotifications = false;
  subscriber();
  banner = preview.querySelector('.wcm-notifications');
  assert.equal(banner.classList.contains('wcm-notifications-monochrome'), false);
  const sidebar = win.document.createElement('div');
  renderEventRow(sidebar, event, plugin, 'sidebar');
  assert.deepEqual([...sidebar.querySelectorAll('button')].map(el => el.textContent), ['•', '••', '']);
  assert.equal(sidebar.querySelector('.wcm-notification-content'), null, 'sidebar markup is unchanged');
  const second = { ...event, key: '2', title: 'Second meeting' };
  events = [event, second]; subscriber();
  assert.equal(banner.querySelector('.wcm-notification'), originalRow, 'adding a meeting keeps the existing row');
  events = [second, event]; subscriber();
  assert.equal(banner.lastElementChild, originalRow, 'calendar sorting moves existing rows');
  events = [event]; subscriber();
  let finishExit;
  let exitOptions;
  let exitFrames;
  let canceled = false;
  win.matchMedia = () => ({ matches: false });
  originalRow.animate = (frames, options) => {
    exitFrames = frames; exitOptions = options;
    return { finished: new Promise(resolve => { finishExit = resolve; }), cancel() { canceled = true; } };
  };
  originalRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  assert.equal(originalRow.inert, true, 'the exiting row ignores repeated actions');
  assert.equal(event.notificationHidden, undefined, 'dismissal waits for the visible exit');
  assert.equal(exitOptions.duration, 160);
  assert.equal(exitFrames[1].transform, 'translateX(-8px)');
  let finishSave;
  pendingSave = new Promise(resolve => { finishSave = resolve; });
  finishExit();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(banner.querySelector('.wcm-notification'), originalRow,
    'the post-animation busy render must not replace the hidden row with a visible clone');
  assert.ok(originalRow.classList.contains('is-dismissed'), 'the hidden final frame survives while saving');
  assert.equal(canceled, false, 'the exit effect stays in place until removal');
  plugin.settings.monochromeNotifications = true; subscriber();
  editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\nMore note content' } });
  banner.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(banner.querySelector('.wcm-notification'), originalRow, 'layout and theme updates retain the exiting node');
  assert.ok(originalRow.classList.contains('is-dismissed'));
  finishSave();
  await new Promise(resolve => setTimeout(resolve, 0));
  pendingSave = undefined;
  assert.equal(canceled, true, 'animation resources are released after dismissal');
  assert.equal(preview.querySelector('.wcm-notifications'), null, 'the final row leaves no empty footer');
  delete event.notificationHidden; subscriber();
  banner = preview.querySelector('.wcm-notifications');
  const reducedRow = banner.querySelector('.wcm-notification');
  win.matchMedia = () => ({ matches: true });
  reducedRow.animate = originalRow.animate;
  reducedRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  assert.equal(exitOptions.duration, 100);
  assert.equal(exitFrames[1].transform, 'none', 'reduced motion fades without travel');
  finishExit();
  await new Promise(resolve => setTimeout(resolve, 0));
  delete event.notificationHidden; subscriber();
  banner = preview.querySelector('.wcm-notifications');
  banner.querySelector('.wcm-notification').animate = () => { throw new Error('keyboard dismissal must not animate'); };
  banner.querySelector('[data-icon=x]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events.length, 1, 'notification-only dismissal leaves the shared sidebar event');
  assert.equal(preview.querySelector('.wcm-notifications'), null);
  assert.equal(editor.dom.querySelector('.wcm-notifications'), null);
  assert.equal(preview.classList.contains('wcm-has-notifications'), false);
  delete event.notificationHidden; subscriber();
  assert.ok(preview.querySelector('.wcm-notifications'));
  // Freshness changes remove banners in both modes without changing the editor document.
  const savedEvents = events;
  events = []; subscriber();
  assert.equal(preview.querySelector('.wcm-notifications'), null);
  assert.equal(editor.dom.querySelector('.wcm-notifications'), null);
  assert.equal(editor.state.doc.toString(), '# Today\nMore note content');
  events = savedEvents; subscriber();
  const sidebarContainer = win.document.createElement('div');
  const sidebarContent = sidebarContainer.createDiv();
  const mobileSidebar = new SimpleMeetingSidebarView({ containerEl: sidebarContainer, contentEl: sidebarContent }, plugin);
  await mobileSidebar.onOpen();
  assert.ok(sidebarContent.querySelector('.wcm-calendar-status'));
  assert.equal(sidebarContent.querySelector('.wcm-reload').textContent, 'Reload synced meetings');
  assert.equal(sidebarContainer.querySelector('.wcm-pill'), null);
  assert.equal(sidebarContainer.querySelector('.wcm-error'), null);
  await mobileSidebar.onClose();
  Platform.isMobile = false;
  const desktopContainer = win.document.createElement('div');
  const desktopSidebar = new SimpleMeetingSidebarView({ containerEl: desktopContainer, contentEl: desktopContainer.createDiv() }, plugin);
  await desktopSidebar.onOpen();
  assert.ok(desktopContainer.querySelector('.wcm-pill'));
  assert.equal(desktopContainer.querySelector('.wcm-calendar-status'), null);
  assert.equal(desktopContainer.querySelector('.wcm-reload'), null);
  await desktopSidebar.onClose();
  view.file.path = 'Other.md'; subscriber();
  assert.equal(preview.querySelector('.wcm-notifications'), null);
});
