const assert=require('node:assert/strict');
const test=require('node:test');
const {build}=require('esbuild');
let api;
global.window={setTimeout};
test.before(async()=>{
 const result=await build({stdin:{contents:'export { MeetingService } from "./src/meeting-service"; export { DailyNoteService } from "./src/daily-note-service"; export { eventIdentity, eventTaskMarker } from "./src/event-identity"; export { TFile, TFolder, FuzzySuggestModal } from "obsidian";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,
 plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export class TFile {} export class TFolder {} export const normalizePath=s=>s; export function getAllTags() {} export function moment() {}
 export class FuzzySuggestModal { static mode='choose'; constructor(app){this.app=app;} setPlaceholder() {} open(){this.app.choices=this.getItems(); if(FuzzySuggestModal.mode==='choose')this.onChooseItem(this.getItems()[1]); this.onClose();} }`}));}}]});
 const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);api=module.exports;
});
const event={id:'local-a',externalId:'shared',key:'one',title:'Catch up',start:'2026-09-23T10:00:00.000Z',end:'2026-09-23T11:00:00.000Z',calendar:'Work',allDay:false,hasGoogleMeet:false};
function fixture(){
 const files=new Map();const contents=new Map();const cache=new Map();const opened=[];let writes=0;let reads=0;let links=0;
 function put(path,content,metadata){const basename=path.split('/').pop().replace(/\.md$/,'');const file=Object.assign(new api.TFile(),{path,basename,parent:{path:path.split('/').slice(0,-1).join('/')}});files.set(path,file);contents.set(path,content);if(metadata)cache.set(path,metadata);return file;}
 const daily=put('Today.md','# Today\n\n## Tasks\n- [ ]\n',{});
 files.set('Meetings',Object.assign(new api.TFolder(),{path:'Meetings'}));
 const app={vault:{getMarkdownFiles:()=>[...files.values()].filter(f=>f instanceof api.TFile),getAbstractFileByPath:path=>files.get(path)??null,
 read:async file=>{reads++;return contents.get(file.path);},create:async(path,content)=>{if(files.has(path))throw Error('exists');writes++;return put(path,content);},
 process:async(file,fn)=>{contents.set(file.path,fn(contents.get(file.path)));},},metadataCache:{getFileCache:file=>cache.get(file.path)??null},
 fileManager:{generateMarkdownLink:file=>'[['+file.basename+']]'},workspace:{getLeaf:()=>({openFile:async file=>opened.push(file.path)})}};
 const dailyNotes=new api.DailyNoteService(app);dailyNotes.getOrCreateToday=async()=>daily;dailyNotes.getLinkLabel=()=> 'Sep 23';dailyNotes.addMeetingReference=async()=>{links++;return true;};
 const people={find:()=>null};let time=false;const service=new api.MeetingService(app,dailyNotes,people,()=> 'Meetings',()=>true,()=>time);
 return {service,app,dailyNotes,put,contents,cache,opened,daily,setTime:value=>{time=value;},get writes(){return writes;},get reads(){return reads;},get links(){return links;}};
}
test('new notes keep the original naming/template and add a sync identity; repeat actions reuse unindexed notes',async()=>{
 const f=fixture();const first=await f.service.createMeeting(event);assert.equal(f.writes,1);assert.match(f.contents.get(first.file.path),/^---\nsimple-meeting-event:/);
 assert.match(f.contents.get(first.file.path),/# Catch up\n\n#Meeting with  on \[\[Today\]\]\n\n- \n$/);
 const again=await f.service.createMeeting({...event,id:'local-b',title:'Renamed'});assert.equal(again.file.path,first.file.path);assert.equal(f.writes,1);assert.equal(f.links,1);
});
test('indexed notes can be moved or renamed and are reused without disk reads',async()=>{
 const f=fixture();f.put('Archive/Renamed.md','existing',{frontmatter:{'simple-meeting-event':api.eventIdentity(event)}});
 const result=await f.service.createMeeting(event);assert.equal(result.file.path,'Archive/Renamed.md');assert.equal(f.reads,0);assert.equal(f.writes,0);
});
test('recurring occurrences and different meetings retain separate numbered notes',async()=>{
 const f=fixture();const first=await f.service.createMeeting(event);const second=await f.service.createMeeting({...event,start:'2026-09-24T10:00:00.000Z'});
 assert.notEqual(first.file.path,second.file.path);assert.equal(f.writes,2);
});
test('offline duplicate notes open an explicit chooser and cancellation is silent',async()=>{
 const f=fixture();const metadata={frontmatter:{'simple-meeting-event':api.eventIdentity(event)}};
 f.put('Meetings/A.md','A',metadata);f.put('Meetings/B.md','B',metadata);
 const result=await f.service.createMeeting(event);assert.equal(f.app.choices.length,2);assert.equal(result.file.path,'Meetings/B.md');assert.equal(f.writes,0);
 api.FuzzySuggestModal.mode='cancel';assert.equal(await f.service.createMeeting(event),null);api.FuzzySuggestModal.mode='choose';assert.equal(f.contents.get('Meetings/A.md'),'A');
});
test('simultaneous local actions share a newly created note instead of making a second one',async()=>{
 const f=fixture();const results=await Promise.all([f.service.createMeeting(event),f.service.createMeeting(event)]);
 assert.equal(results[0].file.path,results[1].file.path);assert.equal(f.writes,1);
});
test('tasks are identified after sync even when title/time setting changes, or they are completed',async()=>{
 const f=fixture();assert.equal(await f.service.addTask(event),true);assert.match(f.contents.get('Today.md'),/<!-- simple-meeting:/);
 f.contents.set('Today.md',f.contents.get('Today.md').replace('- [ ] Catch','- [x] Catch'));
 f.setTime(true);assert.equal(await f.service.addTask({...event,id:'local-b',title:'Renamed'}),false);
 assert.equal((f.contents.get('Today.md').match(/simple-meeting:/g)||[]).length,1);
});
test('legacy task titles are still recognised and offline duplicate task markers never add a third',async()=>{
 const f=fixture();f.contents.set('Today.md','- [ ] Catch up\n');assert.equal(await f.service.addTask(event),false);
 const marker=api.eventTaskMarker(event);f.contents.set('Today.md',`- [ ] Catch up ${marker}\n- [ ] Catch up ${marker}\n`);
 assert.equal(await f.service.addTask(event),false);assert.equal((f.contents.get('Today.md').match(/simple-meeting:/g)||[]).length,2);
});

test('tomorrow banner actions use tomorrow for tasks and meeting backlinks',async()=>{
 const f=fixture();const tomorrow=new Date(2026,8,25,12);const tomorrowFile=f.put('Tomorrow.md','# Tomorrow\n\n## Tasks\n');
 let requested;
 f.dailyNotes.getOrCreateDate=async date=>{requested=date;return tomorrowFile;};
 await f.service.addTask(event,tomorrow);assert.equal(requested,tomorrow);
 assert.match(f.contents.get('Tomorrow.md'),/simple-meeting:/);assert.doesNotMatch(f.contents.get('Today.md'),/simple-meeting:/);
 const meeting=await f.service.createMeeting(event,tomorrow);assert.equal(requested,tomorrow);
 assert.match(f.contents.get(meeting.file.path),/\[\[Tomorrow\]\]/);
});
