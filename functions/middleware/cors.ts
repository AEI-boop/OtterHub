import { cors } from 'hono/cors';

// 安全修复：原实现 origin: (origin) => origin || '*' 会反射任意 Origin。
// 改为仅放行同源请求与本地开发端口（生产前端与 API 同源；
// 本地 dev 前端跑在 3000 端口、后端 8788，需要跨端口）。
// 外部脚本/工具走 API Token（非浏览器），不受 CORS 影响。
const DEV_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export const corsMiddleware = cors({
  origin: (origin, c) => {
    if (!origin) return null;
    try {
      const sameOrigin = origin === new URL(c.req.url).origin;
      return sameOrigin || DEV_ORIGIN_PATTERN.test(origin) ? origin : null;
    } catch {
      return null;
    }
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposeHeaders: ['Content-Length', 'Content-Range'],
  maxAge: 86400,
  credentials: true,
});
