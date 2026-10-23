import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { proxyGet, handleStreamResponse } from "@utils/proxy";
import type { Env } from "../types/hono";
import { authMiddleware } from "../middleware/auth";
import { fail } from "@utils/response";

export const proxyRoutes = new Hono<{ Bindings: Env }>();

const proxySchema = z.object({
  url: z.string().url(),
  headers: z.string().optional(),
  filename: z.string().optional(),
});

const handleProxyRequest = async (c: any) => {
  const {
    url: targetUrl,
    headers: headersParam,
    filename,
  } = c.req.valid("query");
  let customHeaders: Record<string, string> | undefined;

  if (headersParam) {
    try {
      customHeaders = JSON.parse(headersParam);
    } catch {
      // Ignore invalid headers
    }
  }

  try {
    const response = await proxyGet(targetUrl, customHeaders);

    // If filename is provided, force download
    if (filename) {
      const streamResponse = handleStreamResponse(response);
      const newHeaders = new Headers(streamResponse.headers);

      // Preserve spaces in filename - use raw filename for fallback and encoded for RFC 5987
      const encodedFilename = encodeURIComponent(filename);
      // For filename="" part, use raw filename (browsers handle spaces better here)
      // For filename*=UTF-8'' part, use encoded filename for RFC 5987 compliance
      newHeaders.set(
        "Content-Disposition",
        `attachment; filename="${filename.replace(/"/g, '"')}"; filename*=UTF-8''${encodedFilename}`
      );

      return new Response(streamResponse.body, {
        status: streamResponse.status,
        statusText: streamResponse.statusText,
        headers: newHeaders,
      });
    }

    return handleStreamResponse(response);
  } catch (e: any) {
    console.error("Proxy error:", e);
    return fail(c, `Proxy error: ${e.message || "Unknown error"}`, 500);
  }
};

// Protected route for downloads
// 安全修复（S1）：原为公开路由，任何人都可将其作为任意 URL 的
// 中转代理（刷 Workers 额度 + 借你的域名给第三方内容做前台）。
// 现要求登录会话；前端已登录时浏览器自动带 cookie，无感。
proxyRoutes.get(
  "/download",
  authMiddleware,
  zValidator("query", proxySchema),
  handleProxyRequest
);

// Protected route for general proxy
proxyRoutes.get(
  "/",
  authMiddleware,
  zValidator("query", proxySchema),
  handleProxyRequest
);
