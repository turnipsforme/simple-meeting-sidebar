const assert = require('node:assert/strict');
const test = require('node:test');
const { build } = require('esbuild');
let Main;

test.before(async () => {
  const result = await build({
    entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['@codemirror/view', '@codemirror/state'],
    plugins: [{ name: 'plugin-fixture', setup(builder) {
      builder.onResolve({ filter: /^(obsidian|calendar-helper-binary)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'calendar-helper-binary'
        ? 'export default "";'
        : `export class Plugin {} export class Notice {} export class TFile {} export class TFolder {} export class Component {}
           export class MarkdownView {} export class ItemView {} export class Modal {} export class PluginSettingTab {} export class Setting {}
           export const editorInfoField = null; export const normalizePath = s => s; export function setIcon() {} export function getAllTags() {} export function moment() {}` }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', result.outputFiles[0].text)(require, module, module.exports, { platform: 'darwin' });
  Main = module.exports.default;
});

test('refresh input policy survives completion and concurrent requests cannot replace it', async () => {
  const plugin = new Main();
  let finish;
  let fetches = 0;
  const frames = [];
  plugin.performRefresh = () => { fetches++; return new Promise(resolve => { finish = resolve; }); };
  plugin.renderViews = () => frames.push([plugin.isRefreshing(), plugin.shouldAnimateRefreshStatus()]);
  const pointer = plugin.refreshToday(false, true);
  const commandWhileBusy = plugin.refreshToday(true);
  assert.equal(fetches, 1);
  assert.deepEqual(frames, [[true, true]]);
  finish(); await Promise.all([pointer, commandWhileBusy]);
  assert.deepEqual(frames.at(-1), [false, true], 'the same policy drives fade-out');
  const keyboard = plugin.refreshToday(true);
  assert.deepEqual(frames.at(-1), [true, false]);
  finish(); await keyboard;
  assert.deepEqual(frames.at(-1), [false, false]);
});

test('failed refresh clears busy state without losing its completion policy', async () => {
  const plugin = new Main();
  const frames = [];
  plugin.renderViews = () => frames.push([plugin.isRefreshing(), plugin.shouldAnimateRefreshStatus()]);
  plugin.performRefresh = async () => { throw new Error('unavailable'); };
  await assert.rejects(plugin.refreshToday(true, true), /unavailable/);
  assert.deepEqual(frames, [[true, true], [false, true]]);
});

test('pointer dismissal captures layout after saving and immediately before rendering', async () => {
  const plugin = new Main();
  const event = { key: 'meeting' };
  plugin.settings = { cachedEvents: [event] };
  let save;
  const order = [];
  plugin.saveSettings = () => new Promise(resolve => { save = () => { order.push('saved'); resolve(); }; });
  plugin.notifications = { prepareDismissal: key => order.push(key) };
  plugin.renderViews = () => order.push('render');
  const pending = plugin.dismissEvent(event, true, true);
  assert.deepEqual(order, []);
  save(); await pending;
  assert.deepEqual(order, ['saved', 'meeting', 'render']);
  order.length = 0;
  const keyboard = plugin.dismissEvent(event, true);
  save(); await keyboard;
  assert.deepEqual(order, ['saved', 'render']);
  order.length = 0;
  plugin.saveSettings = async () => { throw new Error('save failed'); };
  await assert.rejects(plugin.dismissEvent(event, true, true), /save failed/);
  assert.deepEqual(order, [], 'failed persistence leaves no pending layout snapshot');
});
