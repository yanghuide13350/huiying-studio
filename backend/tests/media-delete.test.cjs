const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'huiying-delete-test-'));
for(const folder of ['videos','merged'])fs.mkdirSync(path.join(root,folder));
const sqlite=new Database(':memory:');sqlite.exec(fs.readFileSync(path.join(__dirname,'fixtures/media-schema.sql'),'utf8'));
const ctx={sqlite,mediaFs:fs,mediaPath:path,STORAGE_ROOT:root,now:()=> 'now'};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/services/media-delete.ts'),'utf8').replace(/^import .*;$/gm,'').replace('export function deleteEpisodeMedia','function deleteEpisodeMedia'),ctx);
const put=rel=>{fs.writeFileSync(path.join(root,rel),'fixture');return 'static/'+rel;};
const shot=(id,episode,url)=>sqlite.prepare("INSERT INTO storyboards(id,episode_id,storyboard_number,description,video_url,created_at,updated_at) VALUES(?,?,?,'保留分镜',?,'before','before')").run(id,episode,id,url);
try{
 const current=put('videos/current.mp4');put('videos/current_poster.jpg');shot(1,1,current);shot(2,2,put('videos/other.mp4'));
 sqlite.prepare("INSERT INTO sys_task(type,storyboard_id,status,local_path,created_at,updated_at) VALUES('video',1,'completed',?,'before','before')").run(put('videos/history.mp4'));
 assert.throws(()=>ctx.deleteEpisodeMedia({kind:'shots',episode_id:1,ids:[2]}),/不属于/);
 ctx.deleteEpisodeMedia({kind:'shots',episode_id:1,ids:[1]});
 for(const f of ['current.mp4','current_poster.jpg','history.mp4'])assert(!fs.existsSync(path.join(root,'videos',f)));
 assert(fs.existsSync(path.join(root,'videos/other.mp4')));
 const retained=sqlite.prepare('SELECT description,video_url FROM storyboards WHERE id=1').get();assert.equal(retained.description,'保留分镜');assert.equal(retained.video_url,null);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM sys_task').get().n,0);
 sqlite.prepare("INSERT INTO video_merges(id,episode_id,drama_id,provider,model,status,merged_url,created_at) VALUES(1,1,1,'ffmpeg','concat','completed',?,'before')").run(put('merged/film.mp4'));put('merged/film_poster.jpg');
 ctx.deleteEpisodeMedia({kind:'merges',episode_id:1,ids:[1]});
 assert(!fs.existsSync(path.join(root,'merged/film.mp4')));assert(!fs.existsSync(path.join(root,'merged/film_poster.jpg')));assert.equal(sqlite.prepare('SELECT count(*) n FROM video_merges').get().n,0);
 shot(3,1,put('videos/shared.mp4'));shot(4,2,'static/videos/shared.mp4');assert.throws(()=>ctx.deleteEpisodeMedia({kind:'shots',episode_id:1,ids:[3]}),/其他记录/);
 sqlite.prepare('UPDATE storyboards SET video_url=NULL WHERE id=4').run();sqlite.prepare("INSERT INTO sys_task(type,storyboard_id,status,created_at,updated_at) VALUES('video',3,'processing','before','before')").run();assert.throws(()=>ctx.deleteEpisodeMedia({kind:'shots',episode_id:1,ids:[3]}),/正在生成/);sqlite.prepare('DELETE FROM sys_task').run();
 sqlite.exec("CREATE TRIGGER fail_delete BEFORE UPDATE ON storyboards BEGIN SELECT RAISE(ABORT,'test rollback'); END;");assert.throws(()=>ctx.deleteEpisodeMedia({kind:'shots',episode_id:1,ids:[3]}),/test rollback/);assert(fs.existsSync(path.join(root,'videos/shared.mp4')));assert.equal(sqlite.prepare('SELECT video_url FROM storyboards WHERE id=3').get().video_url,'static/videos/shared.mp4');sqlite.exec('DROP TRIGGER fail_delete');
 sqlite.prepare("UPDATE storyboards SET video_url='static/videos/../../outside.mp4' WHERE id=3").run();assert.throws(()=>ctx.deleteEpisodeMedia({kind:'shots',episode_id:1,ids:[3]}),/路径异常/);assert(!fs.readdirSync(root).some(n=>n.startsWith('.media-delete-')));
 console.log('PASS: 删除镜头/历史/海报和成片文件；保留分镜与其他剧集；共享/活动任务检查；失败回滚；路径检查。');
}finally{sqlite.close();fs.rmSync(root,{recursive:true,force:true});}
