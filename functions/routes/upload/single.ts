import { Hono } from "hono";
import { FileMetadata, MAX_FILENAME_LENGTH } from "@shared/types";
import { DBAdapterFactory } from "@utils/db-adapter";
import type { Env } from "../../types/hono";
import { fail, ok } from "@utils/response";
import { normalizeUploadTags, parseUploadTags } from "@utils/upload-tags";

export const singleUploadRoutes = new Hono<{ Bindings: Env }>();

singleUploadRoutes.post("/", async (c) => {
  try {
    const formData = await c.req.formData();
    const uploadFile = formData.get("file");

    if (!uploadFile || !(uploadFile instanceof File)) {
      return fail(c, "No file uploaded", 400);
    }

    // F2：前端 canvas 重编码生成的缩略图（可选）。
    // 上传成功后存为 R2 独立对象（thumb: 前缀 + 原图 key），
    // metadata.thumbUrl 指向 /file/:key/thumb2 路由。
    const thumbFile = formData.get("thumb");

    const fileName = uploadFile.name.substring(0, MAX_FILENAME_LENGTH);
    const fileSize = uploadFile.size;
    const isNsfw = formData.get("nsfw") === "true";
    const rawTags = formData.get("tags");
    const tags =
      typeof rawTags === "string" ? parseUploadTags(rawTags) : undefined;

    const dbAdapter = DBAdapterFactory.getAdapter(c.env);
    const metadata: FileMetadata = {
      fileName,
      fileSize,
      uploadedAt: Date.now(),
      liked: false,
      tags: normalizeUploadTags(tags, { forceNsfw: isNsfw }),
    };
    const { key } = await dbAdapter.uploadFile(
      uploadFile,
      metadata,
      c.executionCtx.waitUntil.bind(c.executionCtx)
    );

    // 缩略图以真实 key 落盘 R2（thumb: 前缀，与主文件同桶）
    if (
      thumbFile instanceof File &&
      thumbFile.size > 0 &&
      thumbFile.size < 2 * 1024 * 1024
    ) {
      const r2 = c.env.oh_file_r2;
      if (r2) {
        const thumbKey = `thumb:${key}`;
        await r2.put(thumbKey, await thumbFile.arrayBuffer(), {
          httpMetadata: { contentType: thumbFile.type || "image/webp" },
        });
        // metadata 已在 uploadFile 内写入 KV，此处覆盖一次以带上 thumbUrl
        const kv = c.env.oh_file_url;
        const { value } = await kv.getWithMetadata<FileMetadata>(key);
        await kv.put(key, value ?? "", {
          metadata: { ...metadata, thumbUrl: `/file/${key}/thumb2` },
        });
      }
    }

    return ok(c, key);
  } catch (error: any) {
    console.error("Upload error:", error);
    if (
      error.message?.startsWith("Invalid tag") ||
      error.message === "Invalid tags payload"
    ) {
      return fail(c, error.message, 400);
    }
    return fail(c, `Failed to upload file: ${error.message}`, 500);
  }
});
