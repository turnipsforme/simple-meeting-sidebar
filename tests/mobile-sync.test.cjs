const assert = require('node:assert/strict');
const test = require('node:test');
const { build } = require('esbuild');
const { readFileSync } = require('node:fs');
const cmState = require("@codemirror/state");
const cmView = require("@codemirror/view");
let api;
const source = `
export const Platform = {isMacOS:false, isMobile:true};
export const notices = [];
export class Notice { constructor(text) { notices.push(text); } }
export class Plugin {
  cleanups = []; commands = [];
  register(fn) { this.cleanups.push(fn); }
  registerDomEvent(target, name, fn) { target.addEventListener(name, fn); this.register(() => target.removeEventListener(name, fn)); }
  registerEvent() {} registerEditorExtension() {} registerView() {} addSettingTab() {}
  addCommand(command) { this.commands.push(command); }
}
export class TFile {}
export class TFolder {}
export class Component {} export class MarkdownView {} export class ItemView {} export class Modal {}
export class FuzzySuggestModal {} export class PluginSettingTab {} export class Setting {}
export const editorInfoField = null; export const normalizePath = s => s;
export function setIcon() {} export function getAllTags() {} export function moment() {}
`;
const timers = new Map(); let timerId = 0; let intervals = 0;
global.window = Object.assign(new EventTarget(), {
  setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
  clearTimeout: id => timers.delete(id),
  setInterval: () => { intervals++; return ++timerId; }, clearInterval() {},
});
global.document = Object.assign(new EventTarget(), {visibilityState:'visible'});

test.before(async () => {
  const result = await build({
    stdin: {contents: 'export { default as Main } from "./src/main"; export { SnapshotStore } from "./src/snapshot-store"; export { Platform, TFile, TFolder, notices } from "obsidian";', resolveDir: process.cwd()},
    bundle:true, platform:'node', format:'cjs', write:false, external:['@codemirror/state','@codemirror/view'],
    plugins:[{name:'fixture',setup(b) {
      b.onResolve({filter:/^(obsidian|calendar-helper-binary)$/}, a=>({path:a.path,namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'}, a=>({contents:a.path==='obsidian'?source:'export default "";'}));
    }}],
  });
  const module={exports:{}};
  const mobileRequire = name => {
    assert.ok(name.startsWith('@codemirror/'), `mobile tried to import ${name}`);
    return require(name);
  };
  new Function('require','module','exports','process','Buffer',result.outputFiles[0].text)(mobileRequire,module,module.exports,undefined,undefined);
  api=module.exports;
});
function snapshot(age=0, publisher='mac-a', events) {
  const now=new Date(); const start=new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-1);
  const end=new Date(start); end.setDate(end.getDate()+9);
  const time=new Date(now); time.setHours(12,0,0,0);
  return {version:1,publisher,generatedAt:Date.now()-age,coverageStart:start.toISOString(),coverageEnd:end.toISOString(),timeZone:'Europe/Dublin',selectedCalendars:null,
    events:events ?? [{id:'one',externalId:'shared-one',key:'one',title:'Meeting',start:time.toISOString(),end:new Date(+time+3600000).toISOString(),allDay:false,calendar:'Work',hasGoogleMeet:false}]};
}
function fixture({shared=null, local=null}={}) {
  api.Platform.isMacOS=false; api.Platform.isMobile=true;
  const files=new Map(); const contents=new Map(); const listeners=new Map();
  let layout; let opens=0; let reads=0; let writes=0; let persisted=local; let savedShared;
  const app={
    loadLocalStorage:()=>persisted,saveLocalStorage:(_key,value)=>{persisted=JSON.parse(JSON.stringify(value));},
    metadataCache:{on(){}},
    vault:{
      on(name,fn){ if(!listeners.has(name))listeners.set(name,[]); listeners.get(name).push(fn); },
      getAbstractFileByPath:path=>files.get(path)??null,
      read:async file=>{reads++;return contents.get(file.path);},
      createFolder:async path=>{const folder=Object.assign(new api.TFolder(),{path});files.set(path,folder);return folder;},
      create:async (path,content)=>{if(files.has(path))throw Error('exists');const file=put(path,content);writes++;return file;},
      process:async (file,fn)=>{const content=fn(contents.get(file.path));contents.set(file.path,content);writes++;return content;},
    },
    workspace:{onLayoutReady:fn=>{layout=fn;},getLeavesOfType:()=>[],getRightLeaf:()=>{opens++;throw Error('auto-open');}},
  };
  function put(path,content) { const file=Object.assign(new api.TFile(),{path,stat:{size:Buffer.byteLength(content)}});files.set(path,file);contents.set(path,content);return file; }
  const plugin=new api.Main(); Object.assign(plugin,{app,manifest:{id:'simple-meeting-sidebar'},loadData:async()=>shared,saveData:async data=>{savedShared=data;}});
  return {plugin,app,put,files,contents,emit:(name,...args)=>(listeners.get(name)||[]).forEach(fn=>fn(...args)),layout:()=>layout(),
    get opens(){return opens;},get reads(){return reads;},get writes(){return writes;},get local(){return persisted;},get shared(){return savedShared;},
    close:()=>plugin.cleanups.forEach(fn=>fn()),};
}
async function settle(p) { if(p.refreshPromise)await p.refreshPromise; await Promise.resolve(); }
const path='Meetings/_calendar/events.json';

test('mobile entry and lifecycle need no Node, never open a sidebar, poll, or notify about missing data',async()=>{
  const f=fixture(); const count=api.notices.length; const before=intervals;
  await f.plugin.onload(); f.layout(); await settle(f.plugin);
  assert.equal(f.opens,0); assert.equal(intervals,before); assert.equal(api.notices.length,count);
  assert.deepEqual(f.plugin.getNotificationEvents(),[]);
  assert.match(f.plugin.getCalendarStatus(),/Waiting/);
  assert.equal(f.plugin.settings.sidebarInitialized,false);
  assert.equal(f.plugin.commands[0].name,'Reload synced meetings');
  const reads=f.reads; f.emit('modify',{path:'unrelated.md'});await settle(f.plugin);assert.equal(f.reads,reads);
  f.close();assert.equal(timers.size,0);
});

test('release bundle imports on mobile without process, Buffer, Node or Electron',()=>{
  const module={exports:{}};
  const obsidian={...api,Plugin:class{},Component:class{},ItemView:class{},Modal:class{},FuzzySuggestModal:class{},PluginSettingTab:class{}};
  new Function('require','module','exports','process','Buffer',readFileSync('main.js','utf8'))(name=>{
    if(name==='obsidian')return obsidian;
    if(name.startsWith('@codemirror/'))return require(name);
    throw Error('mobile required '+name);
  },module,module.exports,undefined,undefined);
  assert.equal(typeof module.exports.default,'function');
});

test('sync replaces cancellations; invalid, deleted and older files retain rows but suppress banners',async()=>{
  const f=fixture(); await f.plugin.onload();f.layout();await settle(f.plugin);
  const initial=snapshot(1000);let file=f.put(path,JSON.stringify(initial)); f.emit('create',file);await settle(f.plugin);
  assert.equal(f.plugin.getTodayEvents().length,1);assert.equal(f.plugin.getNotificationEvents().length,1);
  const key=f.plugin.settings.cachedEvents[0].key;
  await f.plugin.dismissEvent(f.plugin.settings.cachedEvents[0],true);
  assert.equal(f.plugin.getNotificationEvents()[0].notificationHidden,true);
  f.put(path,'{');f.emit('modify',file);await settle(f.plugin);
  assert.equal(f.plugin.getTodayEvents().length,1);assert.deepEqual(f.plugin.getNotificationEvents(),[]);
  f.put(path,JSON.stringify(snapshot(2000,'mac-b')));f.emit('modify',file);await settle(f.plugin);
  assert.equal(f.plugin.snapshot.generatedAt,initial.generatedAt);assert.deepEqual(f.plugin.getNotificationEvents(),[]);
  f.put(path,JSON.stringify(initial));f.emit('modify',file);await settle(f.plugin);
  assert.equal(f.plugin.settings.cachedEvents[0].key,key);assert.equal(f.plugin.settings.cachedEvents[0].notificationHidden,true);
  f.files.delete(path);f.emit('delete',file);await settle(f.plugin);assert.deepEqual(f.plugin.getNotificationEvents(),[]);
  const newer=snapshot(0,'mac-b',[]);file=f.put(path,JSON.stringify(newer));f.emit('create',file);await settle(f.plugin);
  assert.deepEqual(f.plugin.getTodayEvents(),[]);assert.ok(f.plugin.getCachedDate());
  assert.equal(f.plugin.snapshot.publisher,'mac-b');f.close();
});

test('overlapping sync reads discard superseded results and keep only one read in flight',async()=>{
  const f=fixture();await f.plugin.onload();let resolve;let calls=0;let active=0;let maxActive=0;
  f.plugin.snapshotStore.read=()=>{calls++;active++;maxActive=Math.max(active,maxActive);return new Promise(r=>{resolve=value=>{active--;r(value);};});};
  const pending=f.plugin.refreshToday(); f.emit('modify',{path});f.emit('modify',{path});
  assert.equal(calls,1);resolve(snapshot(2000));await Promise.resolve();await Promise.resolve();
  assert.equal(calls,2);assert.equal(f.plugin.snapshot,null);
  resolve(snapshot(0,'mac-b',[]));await pending;assert.equal(maxActive,1);assert.equal(f.plugin.snapshot.publisher,'mac-b');f.close();
});

test('freshness timer and foreground resume remove stale banners with no interval',async()=>{
  const f=fixture();await f.plugin.onload();f.put(path,JSON.stringify(snapshot(3599000)));f.layout();await settle(f.plugin);
  assert.equal(f.plugin.getNotificationEvents().length,1);
  const timer=[...timers.values()][0];assert.ok(timer.ms<1500);
  const actualNow=Date.now; const future=actualNow()+2000;Date.now=()=>future;
  // getNotificationEvents uses new Date; explicitly age the snapshot to model elapsed time.
  f.plugin.snapshot.generatedAt-=3000;
  timer.fn(); assert.deepEqual(f.plugin.getNotificationEvents(),[]);Date.now=actualNow;
  f.put(path,JSON.stringify(snapshot(0)));window.dispatchEvent(new Event('focus'));await settle(f.plugin);
  assert.equal(f.plugin.getNotificationEvents().length,1);f.close();
});

test('settings sync cannot replace local actions, and selection mismatches suppress banners',async()=>{
  const f=fixture();await f.plugin.onload();f.put(path,JSON.stringify(snapshot(0)));f.layout();await settle(f.plugin);
  const event=f.plugin.settings.cachedEvents[0];await f.plugin.dismissEvent(event,true);await f.plugin.saveSettings();
  for(const key of ['cachedEvents','cachedDate','lastSuccessfulRefreshAt','sidebarInitialized'])assert.equal(f.shared[key],undefined);
  f.plugin.loadData=async()=>({selectedCalendars:['Other'],cachedEvents:[],meetingNotifications:false});
  await f.plugin.onExternalSettingsChange();
  assert.equal(f.plugin.settings.cachedEvents[0].notificationHidden,true);assert.deepEqual(f.plugin.getNotificationEvents(),[]);
  f.close();
});

test('a Mac migrates its old cache once; mobile never trusts a synced legacy cache',async()=>{
  const legacy={cachedEvents:[{...snapshot().events[0],notificationHidden:true}],cachedDate:'2026-09-23',lastSuccessfulRefreshAt:1000};
  const mobile=fixture({shared:legacy});await mobile.plugin.loadSettings();assert.deepEqual(mobile.plugin.settings.cachedEvents,[]);
  const mac=fixture({shared:legacy});api.Platform.isMacOS=true;api.Platform.isMobile=false;await mac.plugin.loadSettings();
  assert.equal(mac.plugin.settings.cachedEvents[0].notificationHidden,true);
  const again=fixture({shared:{...legacy,cachedEvents:[]},local:mac.local});api.Platform.isMacOS=true;api.Platform.isMobile=false;await again.plugin.loadSettings();
  assert.equal(again.plugin.settings.cachedEvents.length,1);
});

test('multiple Macs publish only newer fetches, recover invalid files and do not overwrite valid newer snapshots',async()=>{
  const f=fixture();const store=new api.SnapshotStore(f.app);const newer=snapshot(0,'mac-b');
  await store.publish(newer);await store.publish(snapshot(3000,'mac-a',[]));
  assert.equal(JSON.parse(f.contents.get(path)).publisher,'mac-b');
  f.put(path,'{');const replacement=snapshot(0,'mac-c',[]);await store.publish(replacement);
  assert.deepEqual((await store.read()).events,[]);
});

test('Mac refresh publishes a selected nine-day snapshot and keeps desktop notifications independent of mobile age',async()=>{
  const f=fixture({shared:{selectedCalendars:['Work'],refreshSchedule:'manual'}});api.Platform.isMacOS=true;api.Platform.isMobile=false;
  await f.plugin.onload();let range;
  const events=snapshot().events;
  f.plugin.calendarService={fetchRange:async(start,end)=>{range={start,end};return [...events,{...events[0],id:'private',calendar:'Private'}];}};
  await f.plugin.refreshToday();
  const written=JSON.parse(f.contents.get(path));assert.equal(written.events.length,1);assert.equal(written.events[0].calendar,'Work');
  assert.ok(range.end-range.start>=8*86400000);assert.ok(f.local.cachedEvents.length===2);
  f.plugin.snapshot.generatedAt-=86400000;assert.equal(f.plugin.getNotificationEvents().length,1);
  assert.equal(f.plugin.getLastError(),'');f.close();
});

test('renaming away from the snapshot suppresses notifications and recreating it restores them',async()=>{
  const f=fixture();await f.plugin.onload();const data=JSON.stringify(snapshot(0));const file=f.put(path,data);f.layout();await settle(f.plugin);
  assert.equal(f.plugin.getNotificationEvents().length,1);
  f.files.delete(path);file.path='Moved.json';f.emit('rename',file,path);await settle(f.plugin);assert.deepEqual(f.plugin.getNotificationEvents(),[]);
  f.put(path,data);f.emit('rename',{path},'Moved.json');await settle(f.plugin);assert.equal(f.plugin.getNotificationEvents().length,1);f.close();
});

test('restart saves the high-water timestamp and local dismissals without duplicating the snapshot event list',async()=>{
  const first=fixture();await first.plugin.onload();const current=snapshot(1000);first.put(path,JSON.stringify(current));first.layout();await settle(first.plugin);
  await first.plugin.dismissEvent(first.plugin.settings.cachedEvents[0],true);assert.equal(first.local.snapshot.events,undefined);first.close();
  const next=fixture({local:first.local});await next.plugin.onload();next.put(path,JSON.stringify(snapshot(5000)));next.layout();await settle(next.plugin);
  assert.equal(next.plugin.snapshot.generatedAt,current.generatedAt);assert.equal(next.plugin.settings.cachedEvents[0].notificationHidden,true);
  assert.deepEqual(next.plugin.getNotificationEvents(),[]);next.close();
});

test('unload during a snapshot read discards the result and schedules no work',async()=>{
  const f=fixture();await f.plugin.onload();let finish;f.plugin.snapshotStore.read=()=>new Promise(resolve=>{finish=resolve;});
  const pending=f.plugin.refreshToday();f.close();finish(snapshot());await pending;assert.equal(f.plugin.snapshot,null);assert.equal(timers.size,0);
});

test('a failed publication keeps successful desktop data and never emits an automatic notice',async()=>{
  const f=fixture({shared:{refreshSchedule:'manual'}});api.Platform.isMacOS=true;api.Platform.isMobile=false;await f.plugin.onload();
  f.plugin.calendarService={fetchRange:async()=>snapshot().events};f.plugin.snapshotStore.publish=async()=>{throw Error('disk busy');};
  const before=api.notices.length;const warn=console.warn;console.warn=()=>{};
  try {await f.plugin.refreshToday();} finally {console.warn=warn;}
  assert.equal(f.plugin.getTodayEvents().length,1);assert.equal(api.notices.length,before);f.close();
});

test('changing calendars during an in-flight Mac fetch publishes only the new selection',async()=>{
  const f=fixture({shared:{selectedCalendars:['Work'],refreshSchedule:'manual'}});api.Platform.isMacOS=true;api.Platform.isMobile=false;await f.plugin.onload();
  let finish;let calls=0;f.plugin.calendarService={fetchRange:()=>{calls++;return calls===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve([]);}};
  const pending=f.plugin.refreshToday();await Promise.resolve();await Promise.resolve();f.plugin.settings.selectedCalendars=[];finish(snapshot().events);await pending;
  assert.equal(calls,2);const published=JSON.parse(f.contents.get(path));assert.deepEqual(published.selectedCalendars,[]);assert.deepEqual(published.events,[]);f.close();
});

test('rendering reuses the date index instead of rescanning nine days, and unchanged reloads do not save data',async()=>{
  const f=fixture();await f.plugin.onload();const current=snapshot(1000);f.put(path,JSON.stringify(current));await f.plugin.refreshToday();
  let saves=0;f.app.saveLocalStorage=()=>{saves++;};await f.plugin.refreshToday();assert.equal(saves,0);
  let startReads=0;const start=current.events[0].start;
  f.plugin.settings.cachedEvents=Array.from({length:9000},(_,index)=>({...current.events[0],id:String(index),key:String(index),get start(){startReads++;return start;}}));
  assert.equal(f.plugin.getTodayEvents().length,9000);const indexed=startReads;
  for(let i=0;i<10;i++)f.plugin.getTodayEvents();
  assert.equal(startReads,indexed,'no date parsing on subsequent renders');f.close();
});
