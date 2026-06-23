// GitHub OAuth 登录入口：跳转到 GitHub 授权页
// GET /api/login

import { jsonResponse } from '../_lib/auth.mjs';

export async function onRequestGet({ env, request }) {
  const clientId = env.GH_CLIENT_ID;
  if (!clientId) {
    return jsonResponse({ error: 'GH_CLIENT_ID 未配置' }, 500);
  }

  // 从请求构造回调地址（同源）
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/callback`;

  // 随机 state 防 CSRF，写短时 cookie 保存
  const state = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user repo', // repo 用于删除 picx 图床图片
    state,
  });

  const githubAuthUrl = `https://github.com/login/oauth/authorize?${params}`;

  const res = new Response(null, {
    status: 302,
    headers: {
      Location: githubAuthUrl,
      // state 存 cookie，callback 时校验（5 分钟有效）
      'Set-Cookie': `pg_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
    },
  });
  return res;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
