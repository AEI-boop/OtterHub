import { Hono } from "hono";
import { FileMetadata, MAX_FILENAME_LENGTH } from "@shared/types";
import { DBAdapterFactory } from "@utils/db-adapter";
import { saveThumb } from "@utils/thumb-store";
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
    // 存储走 thumb-store：R2 优先，TG 适配器部署（无 R2）回退 KV。
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

    if (
      thumbFile instanceof File &&
      thumbFile.size > 0 &&
      thumbFile.size < 2 * 1024 * 1024
    ) {
      const saved = await saveThumb(
        c.env,
        key,
        await thumbFile.arrayBuffer(),
        thumbFile.type || "image/webp"
      );
      if (saved) {
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
