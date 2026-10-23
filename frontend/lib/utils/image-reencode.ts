/**
 * 图片上传重编码工具（F2：EXIF 剥离 + 缩略图生成）
 *
 * 两个能力共享同一管线：decode → canvas → re-encode。
 * canvas 重编码天然丢弃全部元数据（EXIF/GPS/机型/F-number 等），
 * 因为 canvas 位图只保留像素，不携带原文件容器内的元数据段。
 *
 * 均由 GeneralSettings 的开关控制（默认关闭）：
 *  - stripExif：上传的图片替换为重编码版本（原图不保留）
 *  - generateThumb：产出 ~320px WebP 缩略图 Blob（随表单一并提交）
 */

import type { GeneralSettings } from "@shared/types";

const THUMB_MAX_EDGE = 320;
const THUMB_MIME = "image/webp";
const THUMB_QUALITY = 0.82;

export type ReencodeResult = {
  /** 处理后的主文件：stripExif 开启时为重编码版本，否则为原 File */
  file: File;
  /** 缩略图 Blob（generateThumb 开启且为图片时）；关闭或失败时为 null */
  thumb: Blob | null;
};

function isProcessableImage(file: File): boolean {
  const type = file.type.toLowerCase();
  // 仅处理浏览器可解码为位图的格式；SVG 是矢量（canvas 化会破坏语义且本身可含脚本），跳过
  if (type === "image/svg+xml") return false;
  return (
    type.startsWith("image/") &&
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/bmp",
      "image/avif",
    ].includes(type)
  );
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // 走 <img> 兜底（某些环境对部分格式 createImageBitmap 失败）
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    // 保留 img 引用后再释放 URL：<img> 解码完成后仍需 img 完成绘制
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function drawToCanvas(
  source: ImageBitmap | HTMLImageElement,
  maxEdge?: number
): HTMLCanvasElement {
  const sw =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sh =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;

  let w = sw;
  let h = sh;
  if (maxEdge && Math.max(sw, sh) > maxEdge) {
    const scale = maxEdge / Math.max(sw, sh);
    w = Math.max(1, Math.round(sw * scale));
    h = Math.max(1, Math.round(sh * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      mime,
      quality
    );
  });
}

/** 与后端共享的扩展名推导（保持文件名扩展一致） */
function reExt(fileName: string, mime: string): string {
  const base = fileName.replace(/\.[^.]+$/, "") || "image";
  switch (mime) {
    case "image/webp":
      return `${base}.webp`;
    case "image/png":
      return `${base}.png`;
    default:
      return `${base}.jpg`;
  }
}

/**
 * 上传前处理入口。
 * 失败策略：任何解码/编码错误都回退为"原文件直传"，
 * 绝不因重编码失败而阻断用户上传。
 */
export async function processImageForUpload(
  file: File,
  settings: Partial<GeneralSettings> | null | undefined
): Promise<ReencodeResult> {
  const stripExif = settings?.stripExif === true;
  const generateThumb = settings?.generateThumb === true;

  if (!stripExif && !generateThumb) {
    return { file, thumb: null };
  }
  if (!isProcessableImage(file)) {
    return { file, thumb: null };
  }

  try {
    const bitmap = await loadBitmap(file);

    let mainFile = file;
    if (stripExif) {
      // 全尺寸重编码：保持分辨率，仅剥元数据。
      // PNG 无损路径用于带透明通道的输入，其余走 JPEG/WebP 有损。
      const isPngLike =
        file.type === "image/png" ||
        file.type === "image/gif" ||
        file.type === "image/bmp";
      const mime = isPngLike ? "image/png" : "image/webp";
      const canvas = drawToCanvas(bitmap);
      const blob = await canvasToBlob(
        canvas,
        mime,
        mime === "image/webp" ? 0.92 : undefined
      );
      mainFile = new File([blob], reExt(file.name, mime), {
        type: mime,
        lastModified: Date.now(),
      });
    }

    let thumb: Blob | null = null;
    if (generateThumb) {
      const thumbCanvas = drawToCanvas(bitmap, THUMB_MAX_EDGE);
      thumb = await canvasToBlob(thumbCanvas, THUMB_MIME, THUMB_QUALITY);
    }

    if (bitmap instanceof ImageBitmap) {
      bitmap.close();
    }

    return { file: mainFile, thumb };
  } catch (err) {
    console.warn("[upload-reencode] fallback to original file:", err);
    return { file, thumb: null };
  }
}
