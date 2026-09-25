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
  let tomorrowEvents = [];
  let sidebarOpen = false;
  const busy = new Set();
  let pendingSave;
  let actionCount = 0;
  let subscriber;
  const contentEl = create.call(win.document.body, 'div');
  const preview = create.call(contentEl, 'div', {cls: 'markdown-preview-view'});
  const sizer = create.call(preview, 'div', {cls: 'markdown-preview-sizer'});
  const view = new MarkdownView();
  Object.assign(view, { file: {path: 'Today.md'}, contentEl });
  const plugin = {
    settings: { monochromeNotifications: false },
    app: {workspace: {on() {}, getLeavesOfType() { return [{view}]; }}, vault: { getAbstractFileByPath() { return null; } }},
    shouldHideInlineNotifications() { return sidebarOpen; },
    getNotificationEvents(date) { return date.toDateString() === new Date().toDateString() ? events : tomorrowEvents; }, getTodayEvents() { return events; },
    getCalendarStatus() { return 'Calendar updated Sep 23, 10:00.'; }, getLastError() { return 'Internal error must not appear on mobile'; },
    isRefreshing() { return false; }, shouldAnimateRefreshStatus() { return false; }, getCachedDate() { return '2026-09-23'; },
    getPillOffset() { return 0; }, async refreshToday() {},
    isEventBusy(key) { return busy.has(key); },
    subscribe(fn) { subscriber = fn; return () => { subscriber = undefined; }; },
    renderViews() { subscriber?.(); },
    async runEventAction(event, action) {
      actionCount++;
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
  notifications = new MeetingNotifications(plugin, { getTodayPath() { return 'Today.md'; }, getPathForDate(date) { return date.toDateString() === new Date().toDateString() ? 'Today.md' : 'Tomorrow.md'; } });
  notifications.onload();
  let banner = preview.querySelector('.wcm-notifications');
  assert.equal(banner.previousElementSibling, sizer);
  assert.deepEqual([...banner.querySelectorAll('button')].map(el => el.dataset.icon), ['list-todo', 'file-plus-2', 'x']);
  assert.equal(banner.querySelectorAll('.wcm-notification-secondary').length, 2);
  assert.equal(banner.querySelectorAll('button[title]').length, 0, 'only Obsidian aria-label tooltips are present');
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
  let originalRow = banner.querySelector('.wcm-notification');
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
  assert.equal(banner.firstElementChild, originalRow, 'refreshes keep existing visible slots stable');
  // Limit both surfaces and fill a removed slot without moving surviving DOM nodes.
  const third = {...event, key:'3', title:'Third meeting'};
  const fourth = {...event, key:'4', title:'Fourth meeting'};
  const fifth = {...event, key:'5', title:'Fifth meeting'};
  events = [event, second, third, fourth, fifth]; subscriber();
  assert.equal(banner.querySelectorAll('.wcm-notification').length, 3);
  assert.equal(editorBanner.querySelectorAll('.wcm-notification').length, 3);
  assert.equal(banner.querySelector('.wcm-notifications-more').textContent, '+ 2 more');
  const survivors = [...banner.querySelectorAll('.wcm-notification')].slice(1);
  event.notificationHidden=true;subscriber();
  assert.equal(banner.querySelector('.wcm-event-title').textContent, 'Fourth meeting');
  assert.deepEqual([...banner.querySelectorAll('.wcm-notification')].slice(1), survivors);
  assert.equal(banner.querySelector('.wcm-notifications-more').textContent, '+ 1 more');
  busy.add(fourth.key);subscriber();busy.delete(fourth.key);subscriber();
  assert.equal(banner.querySelector('.wcm-event-title').textContent, 'Fourth meeting', 'busy changes do not reorder slots');
  second.sidebarHidden=true;subscriber();
  assert.deepEqual([...banner.querySelectorAll('.wcm-event-title')].map(el=>el.textContent), ['Fourth meeting','Fifth meeting','Third meeting']);
  assert.equal(banner.querySelector('.wcm-notifications-more'), null);
  busy.add(fifth.key);subscriber();busy.delete(fifth.key);subscriber();
  assert.deepEqual([...banner.querySelectorAll('.wcm-event-title')].map(el=>el.textContent), ['Fourth meeting','Fifth meeting','Third meeting']);
  delete event.notificationHidden;delete second.sidebarHidden;
  events = [event]; subscriber();
  function mockExit(row, properties = ['opacity', 'translate']) {
    const transitions = properties.map(transitionProperty => {
      let finish;
      const animation = { transitionProperty, playState: 'running',
        finished: new Promise(resolve => { finish = resolve; }),
        finish() { this.playState = 'finished'; finish(); } };
      return animation;
    });
    row.getAnimations = () => {
      assert.ok(row.classList.contains('is-dismissing'), 'read transitions after applying the exit state');
      return transitions;
    };
    return transitions;
  }
  originalRow = banner.querySelector('.wcm-notification');
  win.matchMedia = () => ({ matches: false });
  const transitions = mockExit(originalRow);
  originalRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  assert.equal(originalRow.inert, true, 'the exiting row ignores repeated actions');
  assert.equal(event.notificationHidden, undefined, 'dismissal waits for the visible exit');
  originalRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  assert.equal(originalRow.classList.contains('is-dismissed'), false, 'the row stays visible during the fade');
  assert.ok(preview.classList.contains('wcm-has-notifications'), 'reading-mode space stays until the exit finishes');
  assert.ok(editor.dom.classList.contains('wcm-has-notifications'), 'editor space stays until the exit finishes');
  transitions[1].finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(event.notificationHidden, undefined, 'finishing movement must not cut the fade short');
  assert.equal(banner.querySelector('.wcm-notification'), originalRow);
  assert.equal(editor.dom.querySelector('.wcm-notifications'), editorBanner);
  let finishSave;
  pendingSave = new Promise(resolve => { finishSave = resolve; });
  transitions[0].finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(banner.querySelector('.wcm-notification'), originalRow,
    'the post-animation busy render must not replace the hidden row with a visible clone');
  assert.ok(originalRow.classList.contains('is-dismissed'), 'the hidden final frame survives while saving');
  plugin.settings.monochromeNotifications = true; subscriber();
  editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\nMore note content' } });
  banner.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(banner.querySelector('.wcm-notification'), originalRow, 'layout and theme updates retain the exiting node');
  assert.ok(originalRow.classList.contains('is-dismissed'));
  finishSave();
  await new Promise(resolve => setTimeout(resolve, 0));
  pendingSave = undefined;
  assert.ok(originalRow.classList.contains('is-dismissed'), 'successful cleanup cannot reveal a saved dismissal');
  assert.equal(actionCount, 1, 'repeated clicks dismiss the meeting only once');
  assert.equal(preview.querySelector('.wcm-notifications'), null, 'the final row leaves no empty footer');
  assert.equal(editor.dom.querySelector('.wcm-notifications'), null);
  assert.equal(preview.classList.contains('wcm-has-notifications'), false);
  assert.equal(editor.dom.classList.contains('wcm-has-notifications'), false);
  delete event.notificationHidden; subscriber();
  banner = preview.querySelector('.wcm-notifications');
  const reducedRow = banner.querySelector('.wcm-notification');
  win.matchMedia = () => ({ matches: true });
  const reducedExit = mockExit(reducedRow, ['opacity']);
  reducedRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  assert.equal(event.notificationHidden, undefined, 'reduced motion still waits for its fade');
  reducedExit[0].finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  delete event.notificationHidden; subscriber();
  const closingEditorRow = editor.dom.querySelector('.wcm-notification');
  const editorExit = mockExit(closingEditorRow);
  closingEditorRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  plugin.settings.monochromeNotifications = false; subscriber();
  editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\n' } });
  assert.equal(editor.dom.querySelector('.wcm-notification'), closingEditorRow, 'typing and refresh keep the fading editor row');
  assert.ok(editor.dom.classList.contains('wcm-has-notifications'));
  editorExit.forEach(animation => animation.finish());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(editor.dom.querySelector('.wcm-notifications'), null);
  assert.equal(editor.dom.classList.contains('wcm-has-notifications'), false);
  editor.dispatch({ changes: { from: editor.state.doc.length - 1, to: editor.state.doc.length } });
  delete event.notificationHidden; subscriber();
  banner = preview.querySelector('.wcm-notifications');
  banner.querySelector('.wcm-notification').getAnimations = () => { throw new Error('keyboard dismissal must not animate'); };
  banner.querySelector('[data-icon=x]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events.length, 1, 'notification-only dismissal leaves the shared sidebar event');
  assert.equal(preview.querySelector('.wcm-notifications'), null);
  assert.equal(editor.dom.querySelector('.wcm-notifications'), null);
  assert.equal(preview.classList.contains('wcm-has-notifications'), false);

  // A deferred redraw cannot flash the finished row. An action that did not
  // update the event must restore the controls, and detached views do no work.
  const isolated = create.call(win.document.body, 'div', { cls: 'wcm-notifications' });
  let detachedActions = 0;
  let hideOnDismiss = false;
  const isolatedEvent = { ...second };
  const isolatedController = { ...plugin,
    async runEventAction(_event, action) { await action(); },
    async dismissEvent(event) { detachedActions++; if (hideOnDismiss) event.notificationHidden = true; },
  };
  renderEventRow(isolated, isolatedEvent, isolatedController, 'notification');
  const isolatedRow = isolated.firstElementChild;
  let isolatedExit = mockExit(isolatedRow);
  isolatedRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  isolatedExit.forEach(animation => animation.finish());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(isolatedRow.inert, false, 'an unsuccessful action leaves the row usable');
  assert.equal(isolatedRow.classList.contains('is-dismissed'), false);
  hideOnDismiss = true;
  isolatedExit = mockExit(isolatedRow);
  isolatedRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  isolatedExit.forEach(animation => animation.finish());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(isolatedRow.isConnected);
  assert.ok(isolatedRow.classList.contains('is-dismissed'), 'save completion cannot reveal a row awaiting redraw');
  assert.equal(isolatedRow.inert, true);
  isolated.replaceChildren();
  renderEventRow(isolated, { ...second }, isolatedController, 'notification');
  const detachedRow = isolated.firstElementChild;
  const detachedExit = mockExit(detachedRow);
  detachedRow.querySelector('[data-icon=x]').dispatchEvent(new win.MouseEvent('click', { detail: 1 }));
  isolated.remove();
  detachedExit.forEach(animation => animation.finish());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(detachedActions, 2, 'closing a view during exit does not save a new dismissal');

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
  // Separate date groups render correctly in both open reading panes and editors.
  tomorrowEvents = [{...event,key:'tomorrow',title:'Tomorrow only'}];
  const tomorrowContent = create.call(win.document.body, 'div');
  const tomorrowPreview = create.call(tomorrowContent, 'div', {cls:'markdown-preview-view'});
  const tomorrowView = new MarkdownView();
  Object.assign(tomorrowView,{file:{path:'Tomorrow.md'},contentEl:tomorrowContent});
  plugin.app.workspace.getLeavesOfType=()=>[{view},{view:tomorrowView}];
  subscriber();
  assert.equal(preview.querySelector('.wcm-event-title').textContent,event.title);
  assert.equal(tomorrowPreview.querySelector('.wcm-event-title').textContent,'Tomorrow only');
  assert.equal(tomorrowPreview.querySelector('[data-icon=list-todo]').getAttribute('aria-label'),"Add to tomorrow's tasks");
  let actionDate;
  plugin.addEventAsTask=async (_event,date)=>{actionDate=date;};
  tomorrowPreview.querySelector('[data-icon=list-todo]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const expectedDate=new Date();expectedDate.setDate(expectedDate.getDate()+1);
  assert.equal(actionDate.toDateString(),expectedDate.toDateString());
  editor.state.field(editorInfoField).file.path='Tomorrow.md';editor.dispatch({});
  assert.equal(editor.dom.querySelector('.wcm-event-title').textContent,'Tomorrow only');
  editor.state.field(editorInfoField).file.path='Other.md';editor.dispatch({});
  assert.equal(editor.dom.querySelector('.wcm-notifications'),null);
  editor.state.field(editorInfoField).file.path='Today.md';editor.dispatch({});

  // Sidebar changes retain the footer during its fade, and interrupt cleanly.
  sidebarOpen=true;subscriber();
  const fading=preview.querySelector('.wcm-notifications');
  assert.ok(fading.classList.contains('wcm-notifications-suppressed'));
  assert.equal(fading.inert,true);
  assert.ok(editor.dom.querySelector('.wcm-notifications-suppressed'));
  sidebarOpen=false;subscriber();
  assert.equal(preview.querySelector('.wcm-notifications'),fading);
  assert.equal(fading.inert,false);
  sidebarOpen=true;subscriber();
  await new Promise(resolve=>setTimeout(resolve,220));
  assert.equal(preview.querySelector('.wcm-notifications'),null);
  assert.equal(editor.dom.querySelector('.wcm-notifications'),null);
  event.sidebarHidden=true;sidebarOpen=false;subscriber();
  assert.equal(preview.querySelector('.wcm-notifications'),null,'sidebar interactions cannot resurrect banners');
  assert.ok(tomorrowPreview.querySelector('.wcm-notifications'),'untouched meetings return');
  delete event.sidebarHidden;subscriber();

  // Check the phone layout rules without driving an app or browser.
  const css=require('node:fs').readFileSync(root+'/styles.css','utf8');
  const style=win.document.createElement('style');
  style.textContent=css;
  win.document.head.append(style);win.document.body.classList.add('is-mobile');
  const compact=preview.querySelector('.wcm-notification');
  assert.equal(win.getComputedStyle(compact).padding,'0px');
  assert.equal(win.getComputedStyle(compact.querySelector('.wcm-notification-content')).gridTemplateColumns,'auto minmax(0, 1fr)');
  assert.equal(win.getComputedStyle(compact.querySelector('.wcm-event-title')).whiteSpace,'nowrap');
  assert.equal(win.getComputedStyle(compact.querySelector('.wcm-event-actions')).gridTemplateColumns,'repeat(3, minmax(0, 1fr))');
  assert.equal(win.getComputedStyle(compact.querySelector('button')).height,'44px');
  assert.equal(win.getComputedStyle(compact.querySelector('button')).width,'100%');
  // Force the real hover/pressed declarations without operating an app.
  const pressed=win.document.createElement('style');
  pressed.textContent=[...style.sheet.cssRules].filter(rule=>rule.selectorText?.includes('.is-mobile') && rule.selectorText.includes('.wcm-action'))
    .map(rule=>rule.cssText.replaceAll(':hover','').replaceAll(':active','')).join('\n');
  win.document.head.append(pressed);
  assert.equal(win.getComputedStyle(compact.querySelector('button')).width,'100%','mobile hit area stays full width while pressed');
  assert.equal(win.getComputedStyle(compact.querySelector('button')).transform,'none');
  let escapedTouches=0, tasks=0, meetings=0;
  editor.dom.addEventListener('touchstart',()=>escapedTouches++);
  editor.dom.addEventListener('pointerdown',()=>escapedTouches++);
  plugin.addEventAsTask=async()=>{tasks++;};
  plugin.createEventMeeting=async()=>{meetings++;};
  for (const icon of ['list-todo','file-plus-2']) {
    const button=editor.dom.querySelector(`[data-icon=${icon}]`);
    for (const type of ['pointerdown','touchstart','pointerup','touchend']) button.dispatchEvent(new win.Event(type,{bubbles:true,cancelable:true}));
    button.dispatchEvent(new win.MouseEvent('click',{bubbles:true,detail:1}));
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  assert.equal(escapedTouches,0,'editor gestures cannot steal control taps');
  assert.equal(tasks,1);assert.equal(meetings,1);
  const close=editor.dom.querySelector('[data-icon=x]');
  close.dispatchEvent(new win.MouseEvent('click',{bubbles:true,detail:1}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(event.notificationHidden,true,'mobile close still dismisses');
  view.file.path = 'Other.md'; subscriber();
  assert.equal(preview.querySelector('.wcm-notifications'), null);
});
