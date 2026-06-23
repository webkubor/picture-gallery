// 查询当前登录态：前端据此显示登录按钮/用户信息/解锁操作
// GET /api/me

import { getSession, jsonResponse } from '../_lib/auth.mjs';

export async function onRequestGet({ request, env }) {
  try {
    const session = await getSession(request, env);
    if (session) {
      return jsonResponse({
        loggedIn: true,
        login: session.login,
        name: session.name,
        avatar: session.avatar,
      });
    }
  } catch {
    // SESSION_SECRET 未配置等情况，视为未登录
  }
  return jsonResponse({ loggedIn: false });
}
