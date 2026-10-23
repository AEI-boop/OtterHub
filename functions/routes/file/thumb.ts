import { Hono } from "hono";
import { getTgFilePath, buildTgFileUrl } from "@utils/db-adapter/tg-tools";
import { getAuthorizedFileAccess } from "./access";
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

// F2：服务前端 canvas 生成的 R2 缩略图（thumb: 前缀对象）。
// 与主文件同桶、同生命周期；访问控制复用 getAuthorizedFileAccess
// （私有文件的缩略图同样需要登录态）。
thumbRoutes.get("/:key/thumb2", async (c) => {
  const key = c.req.param("key");
  const r2 = c.env.oh_file_r2;

  if (!r2) {
    return fail(c, "R2 not configured", 500);
  }

  const access = await getAuthorizedFileAccess(c.env, c.req.raw, key);
  if (access instanceof Response) {
    return access;
  }

  const object = await r2.get(`thumb:${key}`);
  if (!object) {
    return fail(c, "Thumbnail not found", 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { status: 200, headers });
});
