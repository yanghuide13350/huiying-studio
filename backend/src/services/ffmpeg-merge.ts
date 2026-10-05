// @ts-nocheck
/**
 * FFmpeg 多镜头拼接 — 将所有生成后的镜头视频拼接为一集
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { db, getInsertId, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { DATA_ROOT, STORAGE_ROOT } from '../utils/paths.js'

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * 拼接一集的镜头视频。
 * 优先使用视频生成产物，兼容历史的 composedVideoUrl 数据。
 * 传入 storyboardIds 时只拼接所选镜头（仍按镜号顺序）。
 */
export async function mergeEpisodeVideos(episodeId: number, dramaId: number, storyboardIds?: number[]): Promise<number> {
  let storyboards = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)

  if (storyboardIds?.length) {
    const allow = new Set(storyboardIds.map(Number))
    storyboards = storyboards.filter(sb => allow.has(sb.id))
  }

  // 允许部分拼接:按镜号顺序拼接已生成的镜头,未生成的跳过
  const clips = storyboards
    .map(sb => ({ sb, url: sb.videoUrl || sb.composedVideoUrl }))
    .filter(c => Boolean(c.url)) as { sb: typeof storyboards[number]; url: string }[]

  if (clips.length === 0) throw new Error('所选镜头还没有可拼接的视频')

  // 拼接前探测 ffmpeg：二进制损坏时 fluent-ffmpeg 的同步 EFTYPE 会崩掉整个进程，
  // 这里提前拦截并给出可操作的修复指引（路由层会作为 400 返回前端）
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) {
    throw new Error('本机 ffmpeg 不可用，无法拼接视频（常见于 node_modules 跨平台拷贝或 ffmpeg-static 下载损坏）。请删除 node_modules 后在本机重新 npm install，或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件后重启服务')
  }

  // 校验视频文件真实存在:DB 里的 video_url 可能指向已被清理的文件,
  // 直接拼会得到 ffmpeg 的 "No such file or directory" 晦涩报错
  const missing = clips.filter(c => !fs.existsSync(toAbsPath(c.url)))
  if (missing.length > 0) {
    const nums = missing.map(c => `S${c.sb.storyboardNumber}`).join('、')
    throw new Error(`镜头 ${nums} 的视频文件已丢失（本地文件不存在），请重新生成这些镜头的视频，或在拼接时取消勾选`)
  }

  const videos = clips.map(c => c.url)

  logTaskStart('MergeTask', 'episode-merge', { episodeId, dramaId, clips: videos.length })

  // 创建 merge 记录
  const ts = now()
  const res = await db.insert(schema.videoMerges).values({
    episodeId,
    dramaId,
    title: `Episode ${episodeId} Merge`,
    provider: 'ffmpeg',
    model: 'ffmpeg-concat-h264-aac',
    status: 'processing',
    scenes: JSON.stringify(videos),
    createdAt: ts,
  })
  const mergeId = getInsertId(res)

  // 异步执行
  doMerge(mergeId, episodeId, videos).catch(async err => {
    logTaskError('MergeTask', 'episode-merge', { mergeId, episodeId, error: err.message })
    console.error(`[Merge] Failed:`, err)
    await db.update(schema.videoMerges)
      .set({ status: 'failed', errorMsg: err.message })
      .where(eq(schema.videoMerges.id, mergeId))
  })

  return mergeId
}

// HuobaoDrama local merge repair: normalize each input before concat demuxing.
function huobaoProbeMergeMedia(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(new Error(`无法读取视频信息：${path.basename(filePath)}：${err.message}`));
      else resolve(metadata);
    });
  });
}
function huobaoRunMergeCommand(command) {
  return new Promise((resolve, reject) => {
    command.on("end", resolve).on("error", (err) => reject(err)).run();
  });
}
async function huobaoMergeLoudnessFilter(filePath) {
  let diagnostic = "";
  const measure = (0, ffmpeg)().input(filePath).outputOptions([
    "-vn", "-af", "loudnorm=I=-18:TP=-1.5:LRA=20:print_format=json", "-f", "null"
  ]).output("-").on("stderr", (line) => { diagnostic = (diagnostic + line + "\n").slice(-24000); });
  await huobaoRunMergeCommand(measure);
  const match = diagnostic.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error("未能测量素材响度，已停止导出以避免音量失控");
  const metrics = JSON.parse(match[0]);
  const integrated = Number(metrics.input_i);
  if (!Number.isFinite(integrated) || integrated < -50) return ""; // Do not amplify silence or faint noise.
  const target = Math.min(-18, integrated + 8); // Keep quiet ambience quiet; cap amplification at 8 dB.
  const fields = [metrics.input_tp, metrics.input_lra, metrics.input_thresh].map(Number);
  if (!fields.every(Number.isFinite)) throw new Error("素材响度测量值无效");
  console.info(`[Merge loudness] ${integrated.toFixed(1)} LUFS -> ${target.toFixed(1)} LUFS`);
  return `loudnorm=I=${target.toFixed(2)}:TP=-1.5:LRA=20:measured_I=${integrated}:measured_TP=${fields[0]}:measured_LRA=${fields[1]}:measured_thresh=${fields[2]}:offset=0:linear=true,`;
}
function huobaoMergeStreamDuration(stream, format) {
  const direct = Number(stream?.duration);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const rate = String(stream?.avg_frame_rate || stream?.r_frame_rate || "").split("/").map(Number);
  const fps = rate[1] ? rate[0] / rate[1] : rate[0];
  const frames = Number(stream?.nb_frames);
  if (fps > 0 && frames > 0) return frames / fps;
  const fallback = Number(format?.duration);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  throw new Error("素材缺少有效时长，无法安全拼接");
}
async function huobaoMergeNormalizedVideos(videos, outputPath) {
  if (!videos.length) throw new Error("没有可拼接的视频");
  const targetFps = 30;
  const sampleRate = 48000;
  const listDir = path.join(STORAGE_ROOT, "temp");
  fs.mkdirSync(listDir, { recursive: true });
  const jobDir = fs.mkdtempSync(path.join(listDir, "merge-normalized-"));
  let expectedFrames = 0;
  try {
    const metadata = [];
    for (const video of videos) metadata.push(await huobaoProbeMergeMedia(toAbsPath(video)));
    const first = metadata[0].streams.find((stream) => stream.codec_type === "video");
    if (!first?.width || !first?.height) throw new Error("首个素材没有有效视频轨");
    // Apply display rotation before selecting the output canvas dimensions.
    const rotation = Number(first.tags?.rotate ?? first.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? 0);
    const rotated = Math.abs(rotation % 180) === 90;
    const width = Math.ceil((rotated ? first.height : first.width) / 2) * 2;
    const height = Math.ceil((rotated ? first.width : first.height) / 2) * 2;
    const normalizedFiles = [];
    for (let index = 0; index < videos.length; index++) {
      const info = metadata[index];
      const video = info.streams.find((stream) => stream.codec_type === "video");
      if (!video) throw new Error(`第 ${index + 1} 个素材没有视频轨`);
      const frames = Math.max(1, Math.round(huobaoMergeStreamDuration(video, info.format) * targetFps));
      const duration = frames / targetFps;
      expectedFrames += frames;
      const audio = info.streams.find((stream) => stream.codec_type === "audio");
      if (audio) {
        const audioDuration = Number(audio.duration);
        if (audioDuration > 0 && Math.abs(audioDuration - duration) > 0.5) {
          throw new Error(`第 ${index + 1} 个素材音视频时长相差超过 0.5 秒，请先修复该素材`);
        }
      }
      const loudness = audio ? await huobaoMergeLoudnessFilter(toAbsPath(videos[index])) : "";
      const intermediate = path.join(jobDir, `${String(index).padStart(5, "0")}.mov`);
      const command = (0, ffmpeg)().input(toAbsPath(videos[index]));
      if (!audio) command.input("anullsrc=r=48000:cl=stereo").inputOptions(["-f", "lavfi"]);
      // MOV + PCM keeps normalized segment audio sample-exact without AAC priming per clip.
      const filters = [
        `[0:v:0]setpts=PTS-STARTPTS,fps=${targetFps},scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},setpts=N/(${targetFps}*TB)[v]`,
        `[${audio ? "0" : "1"}:a:0]asetpts=PTS-STARTPTS,${loudness}aresample=${sampleRate},aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=duration=${duration.toFixed(9)},asetpts=N/SR/TB[a]`
      ];
      command.complexFilter(filters).outputOptions([
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-threads", "2", "-r", String(targetFps), "-fps_mode", "cfr", "-video_track_timescale", "30000",
        "-c:a", "pcm_s16le", "-ar", String(sampleRate), "-ac", "2", "-map_metadata", "-1"
      ]).output(intermediate);
      await huobaoRunMergeCommand(command);
      normalizedFiles.push(intermediate);
      console.info(`[Merge normalize] ${index + 1}/${videos.length}: ${frames} frames, ${duration.toFixed(3)}s`);
    }
    const listPath = path.join(jobDir, "inputs.ffconcat");
    const escaped = (value) => value.replace(/'/g, "'\\''");
    fs.writeFileSync(listPath, "ffconcat version 1.0\n" + normalizedFiles.map((file) => `file '${escaped(file)}'`).join("\n") + "\n", "utf-8");
    await huobaoRunMergeCommand((0, ffmpeg)().input(listPath).inputOptions(["-f", "concat", "-safe", "0"]).outputOptions([
      "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "aac", "-ar", String(sampleRate),
      "-ac", "2", "-b:a", "192k", "-video_track_timescale", "30000", "-movflags", "+faststart", "-map_metadata", "-1"
    ]).output(outputPath));
    const result = await huobaoProbeMergeMedia(outputPath);
    const video = result.streams.find((stream) => stream.codec_type === "video");
    const audio = result.streams.find((stream) => stream.codec_type === "audio");
    const expectedDuration = expectedFrames / targetFps;
    const videoDuration = Number(video?.duration);
    const audioDuration = Number(audio?.duration);
    const formatDuration = Number(result.format?.duration);
    const tolerance = 0.1;
    if (Number(video?.nb_frames) !== expectedFrames || !Number.isFinite(videoDuration) || Math.abs(videoDuration - expectedDuration) > tolerance || !Number.isFinite(audioDuration) || Math.abs(audioDuration - expectedDuration) > tolerance || !Number.isFinite(formatDuration) || Math.abs(formatDuration - expectedDuration) > tolerance) {
      throw new Error(`拼接结果校验失败：预期 ${expectedFrames} 帧 / ${expectedDuration.toFixed(3)} 秒，视频 ${videoDuration.toFixed(3)} 秒、音频 ${audioDuration.toFixed(3)} 秒`);
    }
    return { duration: expectedDuration, frames: expectedFrames, fps: targetFps, sampleRate, width, height };
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
async function doMerge(mergeId, episodeId, videos) {
  const outputDir = path.join(STORAGE_ROOT, "merged");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFilename = `${uuid()}.mp4`;
  const outputPath = path.join(outputDir, outputFilename);
  const verified = await huobaoMergeNormalizedVideos(videos, outputPath);
  const mergedRelative = `static/merged/${outputFilename}`;
  await extractVideoPoster(mergedRelative);
  await db.update(schema.videoMerges).set({ status: "completed", mergedUrl: mergedRelative, duration: Math.round(verified.duration), completedAt: now() }).where(eq(schema.videoMerges.id, mergeId));
  await db.update(schema.episodes).set({ videoUrl: mergedRelative, updatedAt: now() }).where(eq(schema.episodes.id, episodeId));
  logTaskSuccess("MergeTask", "episode-merge", { mergeId, episodeId, output: mergedRelative, ...verified, clips: videos.length });
}


function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return }
      resolve(Math.round(metadata.format.duration || 0))
    })
  })
}
