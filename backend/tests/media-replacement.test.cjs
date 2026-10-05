const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),os=require('node:os');
const Database=require('better-sqlite3');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'huobao-repaint-test-'));
for(const d of ['images','videos','merged','uploads'])fs.mkdirSync(path.join(root,d));
const sqlite=new Database(':memory:');sqlite.exec(fs.readFileSync(path.join(__dirname,'fixtures/media-schema.sql'),'utf8'));
const ctx={sqlite,mediaFs:fs,mediaPath:path,STORAGE_ROOT:root,parseTaskParams:r=>JSON.parse(r||'{}')};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/services/media-replacement.ts'),'utf8').replace(/^import .*;$/gm,'').replace('export function enqueueReplacementTask','function enqueueReplacementTask'),ctx);
const put=rel=>{fs.writeFileSync(path.join(root,rel),'fixture');return 'static/'+rel;};
const exists=rel=>fs.existsSync(path.join(root,rel));
const enqueue=(type,fields,params={})=>ctx.enqueueReplacementTask(type,{provider:'test'},fields,params,'now');
const addTask=(type,fields,url,params={})=>sqlite.prepare('INSERT INTO sys_task(type,storyboard_id,character_id,scene_id,prop_id,status,local_path,params,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(type,fields.storyboardId??null,fields.characterId??null,fields.sceneId??null,fields.propId??null,'completed',url,JSON.stringify(params),'before','before');
try {
 sqlite.prepare('INSERT INTO storyboards(id,episode_id,storyboard_number,description,video_url,composed_video_url,composed_image,first_frame_image,last_frame_image,created_at,updated_at) VALUES(1,1,1,?,?,?,?,?,?,?,?)').run('保留描述',put('videos/current.mp4'),put('videos/composed.mp4'),put('images/composed.png'),put('images/first.png'),put('images/last.png'),'before','before');
 put('videos/current_poster.jpg');put('videos/old_poster.jpg');
 const old=addTask('video',{storyboardId:1},put('videos/old.mp4'));
 sqlite.prepare('INSERT INTO assets(type,video_gen_id,url,created_at,updated_at) VALUES(?,?,?,?,?)').run('video',Number(old.lastInsertRowid),'static/videos/old.mp4','before','before');
 const id=enqueue('video',{storyboardId:1,prompt:'新提示词'});
 assert.equal(sqlite.prepare('SELECT status FROM sys_task WHERE id=?').get(id).status,'processing');
 assert.equal(sqlite.prepare("SELECT count(*) n FROM sys_task WHERE type='video' AND storyboard_id=1").get().n,1);
 for(const f of ['current.mp4','composed.mp4','old.mp4','current_poster.jpg','old_poster.jpg'])assert(!exists('videos/'+f));
 assert(exists('images/first.png'));assert.equal(sqlite.prepare('SELECT description,video_url FROM storyboards WHERE id=1').get().description,'保留描述');
 assert.equal(sqlite.prepare('SELECT count(*) n FROM assets').get().n,0);
 assert.throws(()=>enqueue('video',{storyboardId:1}),/正在生成/);
 sqlite.prepare("UPDATE sys_task SET status='completed' WHERE id=?").run(id);
 // First/last/composed image histories stay separate.
 addTask('image',{storyboardId:1},put('images/old-first.png'),{frameType:'first_frame'});
 const lastTask=addTask('image',{storyboardId:1},put('images/old-last.png'),{frameType:'last_frame'});
 put('images/first_thumb.webp');enqueue('image',{storyboardId:1},{frameType:'first_frame'});
 assert(!exists('images/first.png'));assert(!exists('images/first_thumb.webp'));assert(!exists('images/old-first.png'));assert(exists('images/last.png'));assert(exists('images/composed.png'));
 assert(sqlite.prepare('SELECT id FROM sys_task WHERE id=?').get(Number(lastTask.lastInsertRowid)));
 for(const [table,key,required] of [['characters','characterId','name'],['scenes','sceneId','location'],['props','propId','name']]) {
   const image=put('images/'+table+'.png'),local=put('images/'+table+'-old.png');
   const extra=table==='scenes'?',time,prompt':'';const extraValues=table==='scenes'?",'day','scene prompt'":'';
   sqlite.prepare(`INSERT INTO ${table}(id,drama_id,${required},image_url,local_path,created_at,updated_at${extra}) VALUES(1,1,'保留文字',?,?,?,?${extraValues})`).run(image,local,'before','before');
   addTask('image',{[key]:1},put('images/'+table+'-history.png'));put('images/'+table+'_thumb.webp');
   enqueue('image',{[key]:1,prompt:'new'});
   assert(!exists('images/'+table+'.png'));assert(!exists('images/'+table+'-old.png'));assert(!exists('images/'+table+'-history.png'));assert(!exists('images/'+table+'_thumb.webp'));
   const entity=sqlite.prepare(`SELECT * FROM ${table} WHERE id=1`).get();assert.equal(entity[required],'保留文字');assert.equal(entity.image_url,null);assert.equal(entity.local_path,null);
 }
 // Shared files and active references cannot be removed.
 const shared=put('images/shared.png');sqlite.prepare('UPDATE storyboards SET composed_image=? WHERE id=1').run(shared);
 sqlite.prepare("INSERT INTO characters(id,drama_id,name,image_url,created_at,updated_at) VALUES(2,1,'shared',?,'before','before')").run(shared);
 assert.throws(()=>enqueue('image',{characterId:2}),/其他记录/);assert(exists('images/shared.png'));
 sqlite.prepare('UPDATE storyboards SET composed_image=NULL WHERE id=1').run();
 assert.throws(()=>enqueue('image',{characterId:2},{referenceImages:[shared]}),/本次生成参考/);assert(exists('images/shared.png'));
 // Insertion failure restores both files and old database state.
 sqlite.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON sys_task BEGIN SELECT RAISE(ABORT,'test insertion failure'); END;");
 assert.throws(()=>enqueue('image',{characterId:2}),/test insertion failure/);assert(exists('images/shared.png'));assert.equal(sqlite.prepare('SELECT image_url FROM characters WHERE id=2').get().image_url,shared);
 sqlite.exec('DROP TRIGGER fail_insert');
 sqlite.prepare("UPDATE characters SET image_url='static/images/../../outside.png' WHERE id=2").run();assert.throws(()=>enqueue('image',{characterId:2}),/路径异常/);
 const outside=path.join(root,'outside.png');fs.writeFileSync(outside,'keep');fs.symlinkSync(outside,path.join(root,'images/link.png'));sqlite.prepare("UPDATE characters SET image_url='static/images/link.png' WHERE id=2").run();assert.throws(()=>enqueue('image',{characterId:2}),/路径异常/);assert(fs.existsSync(outside));
 assert(!fs.readdirSync(root).some(n=>n.startsWith('.repaint-')));
 const free=enqueue('image',{prompt:'untargeted'});assert(sqlite.prepare('SELECT * FROM sys_task WHERE id=?').get(free));
 console.log('PASS: 视频/合成视频/历史/海报替换；角色/场景/道具图片及历史缩略图清理；首尾帧隔离；新任务入队；共享/活动任务/参考保护；任务入队失败回滚；路径和符号链接防护；无目标生成。');
} finally {sqlite.close();fs.rmSync(root,{recursive:true,force:true});}
