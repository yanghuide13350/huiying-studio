// @ts-nocheck
import { OpenAIImageAdapter } from "./openai-image.js";
import { joinProviderUrl } from "./url.js";
import { parseDataUrl } from "../../utils/storage.js";
import type { ImagePollResponse, ImageGenResponse, ProviderRequest, ImageProviderAdapter } from "./types.js";
export class AliyunWanImageAdapter implements ImageProviderAdapter {
  provider = "aliyun";
  unwrap(result) { return result?.success === true && result?.data ? result.data : result; }
  buildGenerateRequest(config, record): ProviderRequest {
    const refs = new OpenAIImageAdapter().parseReferenceImages(record.referenceImages);
    if (refs.length > 9) throw new Error("万相图片最多支持9张参考图");
    const prompt = String(record.prompt || "");
    if (!prompt.trim()) throw new Error("图片提示词不能为空");
    if (prompt.length > 5000) throw new Error("万相图片提示词不能超过5000字，请缩短后重试");
    const size = record.size ? String(record.size).replace(/[xX×]/g, "*") : "2K";
    return {
      url: joinProviderUrl(config.baseUrl, "/api/v1", "/services/aigc/multimodal-generation/generation"),
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: {
        model: record.model || config.model || "wan2.7-image-pro",
        input: { messages: [{ role: "user", content: [...refs.map(image => ({ image })), { text: prompt }] }] },
        parameters: { size, n: 1, watermark: false }
      }
    };
  }
  extractImageUrl(raw) {
    const r = this.unwrap(raw);
    const choices = r?.output?.choices || [];
    for (const choice of choices) for (const part of choice.message?.content || choice.content || []) if (part.image || part.image_url) return part.image || part.image_url?.url || part.image_url;
    return r?.output?.results?.[0]?.url || r?.output?.images?.[0]?.url || r?.data?.[0]?.url || r?.image_url || r?.url || null;
  }
  extractImageBase64(raw) {
    const r = this.unwrap(raw), b64 = r?.data?.[0]?.b64_json;
    if (b64) return { data: b64, mimeType: "image/png" };
    const url = this.extractImageUrl(r);
    return url?.startsWith("data:") ? parseDataUrl(url) : null;
  }
  parseGenerateResponse(raw): ImageGenResponse {
    const r = this.unwrap(raw);
    if (r?.error || r?.code || raw?.success === false) throw new Error(r?.error?.message || r?.message || raw?.detail || "万相图片生成失败");
    const imageUrl = this.extractImageUrl(r);
    if (imageUrl) return { isAsync: false, imageUrl };
    if (this.extractImageBase64(r)) return { isAsync: false };
    const taskId = r?.output?.task_id || r?.task_id;
    if (taskId) return { isAsync: true, taskId };
    throw new Error("万相图片接口未返回图片或任务编号");
  }
  buildPollRequest(config, taskId) {
    return { url: joinProviderUrl(config.baseUrl, "/api/v1", `/tasks/${encodeURIComponent(taskId)}`), method: "GET", headers: { Authorization: `Bearer ${config.apiKey}` }, body: void 0 };
  }
  parsePollResponse(raw): ImagePollResponse {
    const r = this.unwrap(raw), state = String(r?.output?.task_status || r?.task_status || r?.status || "").toUpperCase();
    if (["SUCCEEDED", "COMPLETED"].includes(state)) {
      const imageUrl = this.extractImageUrl(r);
      if (!imageUrl) return { status: "failed", error: "图片任务成功但未返回图片地址" };
      return { status: "completed", imageUrl };
    }
    if (["FAILED", "CANCELED", "CANCELLED", "UNKNOWN"].includes(state) || r?.code || r?.error) return { status: "failed", error: r?.output?.message || r?.error?.message || r?.message || `图片任务 ${state}` };
    return { status: "processing" };
  }
};
