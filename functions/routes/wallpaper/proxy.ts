import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { proxyGet } from "@utils/proxy";
import { authMiddleware } from "../../middleware/auth";
import type { Env } from "../../types/hono";
import { fail } from "@utils/response";

export const wallpaperProxyRoutes = new Hono<{ Bindings: Env }>();

// 安全修复（S1）：壁纸代理原为公开路由，与 /proxy/download 同样
// 可被任意第三方当作公开代理使用（含 CF 边缘缓存 1 小时）。
// 现要求登录会话；前端壁纸页已登录时浏览器自动带 cookie，无感。
wallpaperProxyRoutes.get(
  "/proxy",
  authMiddleware,
  zValidator(
    "query",
    z.object({
      url: z.string().url(),
    })
  ),
  async (c) => {
    const { url: targetUrl } = c.req.valid("query");

    try {
      const response = await proxyGet(targetUrl);

      if (!response.ok) {
        return fail(c, `Upstream request failed`, response.status as any);
      }

      if (!response.body) {
        return fail(c, "Empty response body", 502);
      }

      // 设置 header
      c.header(
        "Content-Type",
        response.headers.get("Content-Type") || "image/jpeg"
      );
      c.header("Cache-Control", "public, max-age=3600, s-maxage=3600");

      // 最后返回 body
      return c.body(response.body);
    } catch (e: any) {
      console.error("Wallpaper proxy error:", e);
      return fail(c, `Wallpaper proxy error: ${e.message}`, 500);
    }
  }
);
