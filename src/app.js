// @ts-check
/**
 * Hono 应用装配
 *
 * 职责：
 * - 用 Hono 做路由分发与中间件管线（迁移检查 / 错误兜底 / 鉴权）
 * - 页面与接口的实际处理逻辑放在 api/ 下，这里只负责按路径转发
 *
 */

import { Hono } from 'hono';

import { handleApiRequest } from './api/router.js';
import { handleAdminRequest, handleLoginPage } from './api/admin.js';
import { handleDebug } from './api/debug.js';
import { getUserFromRequest } from './api/handlers/auth.js';
import { ensureMigrations } from './data/migrate.js';

/**
 * @typedef {{ SUBSCRIPTIONS_KV: KVNamespace }} Bindings
 */

/** @type {Hono<{ Bindings: Bindings }>} */
const app = new Hono();

// ─────────────────────────────────────────────────────────────
// 全局中间件：迁移检查（首次访问透明触发）
// ─────────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  try {
    await ensureMigrations(c.env);
  } catch (err) {
    console.error('[app] 迁移失败，回退继续处理请求:', err);
  }
  await next();
});

// ─────────────────────────────────────────────────────────────
// 全局错误兜底
// ─────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[app] 未捕获异常:', err && err.stack ? err.stack : err);
  // 统一的错误格式
  return c.json(
    {
      success: false,
      message: err && err.message ? err.message : '服务异常',
      code: 'internal_error'
    },
    500
  );
});

// ─────────────────────────────────────────────────────────────
// 路由：根路径
// 已登录跳 /admin；未登录返回登录页
// ─────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const { user } = await getUserFromRequest(c.req.raw, c.env);
  if (user) return c.redirect('/admin');
  return handleLoginPage();
});

// ─────────────────────────────────────────────────────────────
// 路由：/debug（必须登录）
// ─────────────────────────────────────────────────────────────
app.all('/debug', async (c) => {
  const { user } = await getUserFromRequest(c.req.raw, c.env);
  if (!user) {
    return new Response('未授权访问', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
  return handleDebug(c.req.raw, c.env);
});

// ─────────────────────────────────────────────────────────────
// 路由：/api/*（认证由 handler 内部处理，与前端页面的约定一致）
// ─────────────────────────────────────────────────────────────
app.all('/api/*', async (c) => {
  return handleApiRequest(c.req.raw, c.env);
});

// ─────────────────────────────────────────────────────────────
// 路由：/admin/*
// ─────────────────────────────────────────────────────────────
app.all('/admin/*', async (c) => {
  return handleAdminRequest(c.req.raw, c.env);
});

app.get('/admin', async (c) => {
  return handleAdminRequest(c.req.raw, c.env);
});

// ─────────────────────────────────────────────────────────────
// 兜底：其他路径返回登录页（（兜底行为））
// ─────────────────────────────────────────────────────────────
app.all('*', async () => {
  return handleLoginPage();
});

export default app;
