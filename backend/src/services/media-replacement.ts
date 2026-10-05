// @ts-nocheck
import mediaFs from "node:fs";
import mediaPath from "node:path";
import { sqlite } from "../db/index.js";
import { STORAGE_ROOT } from "../utils/paths.js";
const parseTaskParams = raw => { try { return JSON.parse(raw || "{}") || {} } catch { return {} } };
// Enqueue a replacement atomically with removal of the target's previous media.
export function enqueueReplacementTask(type, config, fields, params, ts) {
  const targets = [['storyboardId','storyboard_id','storyboards'],['characterId','character_id','characters'],['sceneId','scene_id','scenes'],['propId','prop_id','props']].filter(([key])=>fields[key]!=null);
  if (targets.length > 1) throw new Error('生成目标无效');
  const target = targets[0];
  const tasks = sqlite.prepare('SELECT * FROM sys_task').all();
  const assets = sqlite.prepare('SELECT * FROM assets').all();
  let row, columns=[], oldTasks=[], oldAssets=[];
  const frame = p => p.frameType === 'first_frame' ? 'first_frame_image' : p.frameType === 'last_frame' ? 'last_frame_image' : 'composed_image';
  if (target) {
    const [key,fk,table] = target;
    if (!Number.isSafeInteger(fields[key]) || fields[key]<=0 || (type==='video' && table!=='storyboards')) throw new Error('生成目标无效');
    row = sqlite.prepare(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`).get(fields[key]);
    if (!row) throw new Error('生成目标不存在');
    columns = type==='video' ? ['video_url','composed_video_url'] : table==='storyboards' ? [frame(params)] : ['image_url','local_path'];
    oldTasks = tasks.filter(t=>t.type===type && t[fk]===fields[key] && (table!=='storyboards' || type==='video' || frame(parseTaskParams(t.params))===frame(params)));
    if (oldTasks.some(t=>['processing','pending'].includes(t.status))) throw new Error('该素材正在生成，请完成后再重绘');
  }
  const root = mediaFs.realpathSync(STORAGE_ROOT);
  function local(value) {
    if (!value || /^(https?:|data:)/i.test(value)) return null;
    let rel=String(value).replace(/^\//,'');
    if (!/^static\/(images|videos|merged|uploads)\/[^/]+$/.test(rel) || rel.includes('..')) throw new Error('素材路径异常，已停止重绘');
    const file=mediaPath.resolve(root,rel.slice(7));
    if (mediaFs.existsSync(file) && mediaFs.realpathSync(file)!==file || mediaFs.realpathSync(mediaPath.dirname(file))!==mediaPath.dirname(file)) throw new Error('素材路径异常，已停止重绘');
    return file;
  }
  const values=[...columns.map(c=>row[c]),...oldTasks.flatMap(t=>[t.local_path,t.result_url])];
  const files=new Set(values.map(local).filter(Boolean));
  const matches=v=>{if(!v)return false;try{return files.has(local(v));}catch{return false;}};
  oldAssets=assets.filter(a=>a.type===type && (oldTasks.some(t=>a[type==='video'?'video_gen_id':'image_gen_id']===t.id) || [a.local_path,a.url].some(matches)));
  oldAssets.flatMap(a=>[a.local_path,a.url,a.thumbnail_url]).map(local).filter(Boolean).forEach(f=>files.add(f));
  const mediaColumns={storyboards:['video_url','composed_video_url','composed_image','first_frame_image','last_frame_image'],characters:['image_url','local_path'],scenes:['image_url','local_path'],props:['image_url','local_path'],video_merges:['merged_url']};
  for (const [table,cols] of Object.entries(mediaColumns)) {
    for (const other of sqlite.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL`).all()) {
      const refs=cols.filter(c=>!(target && table===target[2] && other.id===fields[target[0]] && columns.includes(c)));
      if (refs.some(c=>matches(other[c]))) throw new Error('旧素材仍被其他记录使用，已停止重绘');
      if (table==='video_merges' && ['pending','processing'].includes(other.status) && [...files].some(f=>String(other.scenes||'').includes(mediaPath.basename(f)))) throw new Error('旧素材正在用于拼接，请完成后再重绘');
    }
  }
  if (tasks.filter(t=>!oldTasks.includes(t)).some(t=>[t.local_path,t.result_url].some(matches))) throw new Error('旧素材仍被其他任务使用，已停止重绘');
  if (assets.filter(a=>!oldAssets.includes(a)).some(a=>[a.local_path,a.url,a.thumbnail_url].some(matches))) throw new Error('旧素材仍被其他素材记录使用，已停止重绘');
  if (tasks.some(t=>['pending','processing'].includes(t.status) && [...files].some(f=>String(t.params||'').includes(mediaPath.basename(f))))) throw new Error('旧素材正在用于生成，请完成后再重绘');
  if ([...files].some(f=>JSON.stringify(params).includes(mediaPath.basename(f)))) throw new Error('旧素材正在作为本次生成参考，请移除该参考后重绘');
  for (const file of [...files]) {
    const sidecar=file.replace(/\.[^./]+$/,type==='video'?'_poster.jpg':'_thumb.webp');
    if (mediaFs.existsSync(sidecar)) {if(mediaFs.realpathSync(sidecar)!==sidecar)throw new Error('缩略图路径异常');files.add(sidecar);}
  }
  const staged=mediaPath.join(root,`.repaint-${Date.now()}-${Math.random().toString(36).slice(2)}`),moved=[];
  mediaFs.mkdirSync(staged);
  let id;
  try {
    for (const file of files) if(mediaFs.existsSync(file)){const dest=mediaPath.join(staged,String(moved.length));mediaFs.renameSync(file,dest);moved.push([file,dest]);}
    id=sqlite.transaction(()=>{
      if (target) {
        sqlite.prepare(`UPDATE ${target[2]} SET ${columns.map(c=>`${c}=NULL`).join(',')}, updated_at=? WHERE id=?`).run(ts,fields[target[0]]);
        for(const t of oldTasks)sqlite.prepare('DELETE FROM sys_task WHERE id=?').run(t.id);
        for(const a of oldAssets)sqlite.prepare('DELETE FROM assets WHERE id=?').run(a.id);
      }
      return Number(sqlite.prepare('INSERT INTO sys_task (type,storyboard_id,drama_id,scene_id,character_id,prop_id,provider,prompt,model,params,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(type,fields.storyboardId??null,fields.dramaId??null,fields.sceneId??null,fields.characterId??null,fields.propId??null,config.provider,fields.prompt??null,fields.model??null,JSON.stringify(params),'processing',ts,ts).lastInsertRowid);
    })();
  } catch(error){for(const [file,dest] of moved.reverse())mediaFs.renameSync(dest,file);mediaFs.rmdirSync(staged);throw error;}
  mediaFs.rmSync(staged,{recursive:true});
  return id;
}
