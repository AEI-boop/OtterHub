import { createMiddleware } from "hono/factory";
import { verifyJWT } from "@utils/auth";
import type { Env } from "../types/hono";
import { fail } from "@utils/response";

// 安全修复（auth bypass）：移除按扩展名放行的正则。
// 该正则匹配的是完整请求路径，而文件 key 天然以 .png/.jpg 等结尾，
// 曾导致 DELETE /file/img:xxx.png（任意文件永久删除）与
// GET /trash/trash:img:xxx.png（回收站未鉴权读取）绕过鉴权。
// 静态资源由 [[path]].ts 的 404 回落机制交给 Pages 处理，不经此中间件，
// 因此此列表仅保留永远不会与挂载路由冲突的前缀。
const PUBLIC_PATHS = [/^\/$/, /^\/auth\/login/, /^\/_next\//];

export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const path = c.req.path;
    const method = c.req.method;

    // 纵深防御：公开路径放行仅限安全方法，写操作（POST/PUT/PATCH/DELETE）一律走鉴权
    if (method === "GET" || method === "HEAD") {
      if (PUBLIC_PATHS.some((pattern) => pattern.test(path))) {
        await next();
        return;
      }
    }

    const env = c.env;

    // 1. 优先检查 API Token (Authorization Header)
    const authHeader = c.req.header("Authorization");
    if (authHeader && env.API_TOKEN) {
      const token = authHeader.replace(/Bearer\s+/i, "");
      if (token === env.API_TOKEN) {
        await next();
        return;
      }
    }

    // 2. 检查 Cookie
    const cookie = c.req.header("Cookie");
    const authCookie = cookie?.match(/(?:^|;\s*)auth=([^;]+)/)?.[1];

    if (!authCookie) {
      // 安全修复：不再把请求 Cookie 头反射回错误消息
      return fail(c, "Unauthorized", 401);
    }

    // 安全修复（fail closed）：secret 缺失时拒绝验证，
    // 不再回退到公开常量 'secret'（任何人可伪造 JWT）
    const secret = env.JWT_SECRET || env.PASSWORD;
    if (!secret) {
      return fail(c, "Unauthorized", 401);
    }

    try {
      await verifyJWT(authCookie, secret);
      await next();
    } catch (e) {
      return fail(c, "Unauthorized", 401);
    }
  }
);
