// GitHub OAuth 登录入口：跳转到 GitHub 授权页
// GET /api/login

import { jsonResponse } from '../_lib/auth.mjs';

// 固定正式域名（OAuth App 的 callback URL 必须与之一致，不能用动态 origin）
const APP_ORIGIN = 'https://pictures.webkubor.online';

export async function onRequestGet({ env }) {
  const clientId = env.GH_CLIENT_ID;
  if (!clientId) {
    return jsonResponse({ error: 'GH_CLIENT_ID 未配置' }, 500);
  }

  const redirectUri = `${APP_ORIGIN}/api/callback`;

  // 随机 state 防 CSRF，写短时 cookie 保存
  const state = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user repo', // repo 用于删除 picx 图床图片
    state,
  });

  const githubAuthUrl = `https://github.com/login/oauth/authorize?${params}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: githubAuthUrl,
      // state 存 cookie，callback 时校验（5 分钟有效）
      'Set-Cookie': `pg_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
    },
  });
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
