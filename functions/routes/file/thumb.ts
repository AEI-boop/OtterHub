import { Hono } from "hono";
import { getTgFilePath, buildTgFileUrl } from "@utils/db-adapter/tg-tools";
import { getAuthorizedFileAccess } from "./access";
import { loadThumb } from "@utils/thumb-store";
import type { Env } from "../../types/hono";
import { fail } from "@utils/response";

export const thumbRoutes = new Hono<{ Bindings: Env }>();

thumbRoutes.get("/:key/thumb", async (c) => {
  const thumbFileId = c.req.param("key");
  const botToken = c.env.TG_BOT_TOKEN;

  if (!botToken) {
    return fail(c, "TG_BOT_TOKEN not configured", 500);
  }

  try {
    const filePath = await getTgFilePath(thumbFileId, botToken);
    if (!filePath) {
      return fail(c, "Thumbnail not found", 404);
    }

    const thumbUrl = buildTgFileUrl(botToken, filePath);
    const response = await fetch(thumbUrl);

    if (!response.ok) {
      return fail(c, "Failed to fetch thumbnail", 502);
    }

    c.header(
      "Content-Type",
      response.headers.get("Content-Type") || "image/jpeg"
    );
    c.header("Cache-Control", "public, max-age=86400");

    return response.body ? c.body(response.body) : c.body(null);
  } catch (error: any) {
    console.error("Fetch thumbnail error:", error);
    return fail(c, error.message);
  }
});

// F2：服务前端 canvas 生成的缩略图（thumb-store：R2 或 KV 回退）。
// 与主文件同生命周期；访问控制复用 getAuthorizedFileAccess
// （私有文件的缩略图同样需要登录态）。
thumbRoutes.get("/:key/thumb2", async (c) => {
  const key = c.req.param("key");

  const access = await getAuthorizedFileAccess(c.env, c.req.raw, key);
  if (access instanceof Response) {
    return access;
  }

  const thumb = await loadThumb(c.env, key);
  if (!thumb) {
    return fail(c, "Thumbnail not found", 404);
  }

  return new Response(thumb.body, {
    status: 200,
    headers: {
      "Content-Type": thumb.contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});
