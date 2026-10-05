/**
 * 资产提取任务 — 异步执行，按「集 × 类型」粒度跟踪
 * 角色 / 场景 / 道具 可分别单独提取，同一集的不同类型可并行
 * 任务状态为进程内内存态：后端重启后运行中的任务状态丢失（Agent 调用本身已被中断）
 */
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export type ExtractTarget = 'characters' | 'scenes' | 'props'
export const EXTRACT_TARGETS: ExtractTarget[] = ['characters', 'scenes', 'props']

export interface ExtractTask {
  status: 'running' | 'done' | 'error'
  started_at: string
  finished_at?: string
  error?: string
}

const tasks = new Map<string, ExtractTask>()
const keyOf = (episodeId: number, target: string) => `${episodeId}:${target}`

/** 每类资产的提取指令：限定只提取该类型，并要求与已有数据去重合并 */
const EXTRACT_MESSAGES = {
 characters: "只提取当前集角色。先读剧本、已有角色与原文依据，按人物＋真实阶段建立可复用造型；服装身份年龄阶段不同分别保存，共享 base_name、identity_anchor 和同年龄组 voice_profile，不把括号阶段去掉合并。使用 save_dedup_characters 保存，别修改场景和道具。",
 scenes: "只提取当前集场景。读取剧本与已有场景，按地点＋时间段复用；无人参考空间，固定布局与光源，使用 save_dedup_scenes 保存，别修改角色和道具。",
 props: "只提取当前集推动剧情且需稳定外观的关键道具。读取剧本、已有道具及必要原著资料；不硬性限制为三个，保留关键铭文，明确细字需核验。使用 save_dedup_props 保存，别修改角色和场景。"
};

export function startExtraction(episodeId: number, dramaId: number, target: ExtractTarget, opts: { model?: string; configId?: number } = {}): boolean {
  const key = keyOf(episodeId, target)
  if (tasks.get(key)?.status === 'running') return false

  const task: ExtractTask = { status: 'running', started_at: new Date().toISOString() }
  tasks.set(key, task)

  logTaskStart('Extract', target, { episodeId, dramaId, model: opts.model || undefined, configId: opts.configId || undefined })
  ;(async () => {
    const agent = mastra.getAgent('extractor')
    if (!agent) throw new Error('提取 Agent 不可用')
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
    })
    return agent.generate([{ role: 'user', content: EXTRACT_MESSAGES[target] }], {
      maxSteps: 20,
      requestContext,
      // 逐步打印 Agent 进展：调用了哪些工具、输出了什么
      onStepFinish: (step: any) => {
        const tools = (step?.toolCalls || [])
          .map((t: any) => t?.toolName || t?.payload?.toolName)
          .filter(Boolean)
        logTaskProgress('Extract', `${target}-step`, {
          episodeId,
          tools: tools.length ? tools.join(',') : undefined,
          text: (step?.text || '').slice(0, 200) || undefined,
        })
      },
    })
  })()
    .then((result: any) => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      const toolNames = (result?.toolCalls || []).map((t: any) => t?.toolName).filter(Boolean)
      logTaskSuccess('Extract', target, {
        episodeId,
        steps: result?.steps?.length,
        toolCalls: toolNames.join(',') || undefined,
        reply: (result?.text || '').slice(0, 300) || undefined,
      })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '提取失败'
      logTaskError('Extract', target, { episodeId, error: err?.message })
    })
  return true
}

/** 查询某集三类资产的提取任务状态（未启动过的类型为 null） */
export function getExtractionStatus(episodeId: number): Record<ExtractTarget, ExtractTask | null> {
  const result = {} as Record<ExtractTarget, ExtractTask | null>
  for (const target of EXTRACT_TARGETS) result[target] = tasks.get(keyOf(episodeId, target)) || null
  return result
}
