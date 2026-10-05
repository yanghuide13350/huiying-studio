// @ts-nocheck
import mediaFs from "node:fs";
import mediaPath from "node:path";
import { sqlite } from "../db/index.js";
import { STORAGE_ROOT } from "../utils/paths.js";
import { now } from '../utils/response.js';
export function deleteEpisodeMedia(body) {
  const {kind, episode_id: episodeId, ids} = body;
  if (!['shots', 'merges'].includes(kind) || !Number.isSafeInteger(episodeId) || episodeId <= 0 || !Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('删除参数无效');
  const selected = new Set(ids);
  const table = kind === 'shots' ? 'storyboards' : 'video_merges';
  const rows = sqlite.prepare(`SELECT * FROM ${table} WHERE episode_id = ? AND deleted_at IS NULL`).all(episodeId).filter(row => selected.has(row.id));
  if (rows.length !== selected.size) throw new Error('所选记录已变更或不属于当前剧集，请刷新后重试');
  const tasks = sqlite.prepare('SELECT * FROM sys_task').all();
  const merges = sqlite.prepare('SELECT * FROM video_merges WHERE deleted_at IS NULL').all();
  const shots = sqlite.prepare('SELECT * FROM storyboards WHERE deleted_at IS NULL').all();
  const assets = sqlite.prepare('SELECT * FROM assets WHERE deleted_at IS NULL').all();
  const removedTasks = kind === 'shots' ? tasks.filter(t => t.type === 'video' && selected.has(t.storyboard_id)) : [];
  if (removedTasks.some(t => ['processing','pending'].includes(t.status)) || rows.some(r => kind === 'merges' && ['processing','pending'].includes(r.status))) throw new Error('所选视频正在生成或拼接，请完成后再删除');
  if (kind === 'shots' && merges.some(m => m.episode_id === episodeId && ['processing','pending'].includes(m.status))) throw new Error('当前剧集正在拼接，请完成后再删除镜头视频');
  const removedAssets = kind === 'shots' ? assets.filter(a => a.type === 'video' && selected.has(a.storyboard_id)) : [];
  const root = mediaFs.realpathSync(STORAGE_ROOT);
  function localPath(value) {
    if (!value || /^https?:\/\//i.test(value)) return null;
    const rel = String(value).replace(/^\//, '');
    if (!/^static\/(videos|merged)\/[^/]+$/.test(rel) || rel.includes('..')) throw new Error('视频文件路径异常，已停止删除');
    const abs = mediaPath.resolve(root, rel.slice(7));
    if (mediaFs.existsSync(abs) && mediaFs.realpathSync(abs) !== abs) throw new Error('视频文件路径异常，已停止删除');
    if (mediaFs.realpathSync(mediaPath.dirname(abs)) !== mediaPath.dirname(abs)) throw new Error('视频文件目录异常，已停止删除');
    return abs;
  }
  const values = kind === 'shots' ? [...rows.flatMap(r => [r.video_url,r.composed_video_url]), ...removedTasks.flatMap(t => [t.local_path,t.result_url]), ...removedAssets.flatMap(a=>[a.local_path,a.url,a.thumbnail_url])] : rows.map(r=>r.merged_url);
  const files = new Set(values.map(localPath).filter(Boolean));
  // Keep references in other shots/tasks/assets safe; shared media requires a separate choice.
  const refs = [...shots.filter(s=>kind !== 'shots' || !selected.has(s.id)).flatMap(s=>[s.video_url,s.composed_video_url]), ...tasks.filter(t=>!removedTasks.includes(t)).flatMap(t=>[t.local_path,t.result_url]), ...merges.filter(m=>kind !== 'merges' || !selected.has(m.id)).map(m=>m.merged_url), ...assets.filter(a=>!removedAssets.includes(a)).flatMap(a=>[a.local_path,a.url,a.thumbnail_url])];
  const shared = refs.filter(v=>v && !/^https?:\/\//i.test(v)).some(v=>{try {return files.has(localPath(v));} catch {return false;}});
  if (shared) throw new Error('所选视频文件仍被其他记录使用，已停止删除');
  for (const merge of merges.filter(m=>["processing","pending"].includes(m.status))) {
    if ([...files].some(file=>String(merge.scenes || "").includes(mediaPath.basename(file)))) throw new Error("所选视频正被拼接任务引用，请完成后再删除");
  }
  for (const task of tasks.filter(t=>['processing','pending'].includes(t.status))) {
    if ([...files].some(file => String(task.params || '').includes(mediaPath.basename(file)))) throw new Error('所选视频正被生成任务引用，请完成后再删除');
  }
  for (const file of [...files]) {
    const poster = file.replace(/\.[^./]+$/, '_poster.jpg');
    if (mediaFs.existsSync(poster)) {
      if (mediaFs.realpathSync(poster) !== poster) throw new Error('视频海报路径异常');
      files.add(poster);
    }
  }
  const quarantine = mediaPath.join(root, `.media-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mediaFs.mkdirSync(quarantine);
  const moved = [];
  try {
    for (const file of files) {
      if (!mediaFs.existsSync(file)) continue;
      const staged = mediaPath.join(quarantine, String(moved.length));
      mediaFs.renameSync(file, staged); moved.push([file,staged]);
    }
    sqlite.transaction(() => {
      if (kind === 'shots') {
        const update = sqlite.prepare("UPDATE storyboards SET video_url = NULL, composed_video_url = NULL, status = 'pending', updated_at = ? WHERE id = ? AND episode_id = ?");
        for (const row of rows) update.run(now(),row.id,episodeId);
        for (const task of removedTasks) sqlite.prepare('DELETE FROM sys_task WHERE id = ?').run(task.id);
        for (const asset of removedAssets) sqlite.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
      } else {
        for (const row of rows) sqlite.prepare('DELETE FROM video_merges WHERE id = ? AND episode_id = ?').run(row.id,episodeId);
      }
    })();
  } catch (error) {
    for (const [file,staged] of moved.reverse()) mediaFs.renameSync(staged,file);
    mediaFs.rmdirSync(quarantine); throw error;
  }
  // Records and files have been removed; don't claim success if cleanup fails.
  mediaFs.rmSync(quarantine,{recursive:true});
  return {deleted_ids:[...selected],deleted_files:moved.length};
}
