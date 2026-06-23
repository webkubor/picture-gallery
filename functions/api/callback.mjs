// GitHub OAuth 回调：code 换 access_token → 查用户信息 → 校验是否本人 → 设签名 session cookie
// GET /api/callback?code=xxx&state=yyy

import { ALLOWED_USER, SESSION_COOKIE, getSecret, signSession, jsonResponse } from '../_lib/auth.mjs';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // 1. 校验 state 防 CSRF
  const cookie = request.headers.get('Cookie') || '';
  const stateMatch = cookie.match(/pg_oauth_state=([^;]+)/);
  const savedState = stateMatch ? stateMatch[1] : null;

  if (!code || !state || state !== savedState) {
    return new Response('授权失败：state 校验不通过', { status: 400 });
  }

  const clientId = env.GH_CLIENT_ID;
  const clientSecret = env.GH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('OAuth 未配置：缺少 GH_CLIENT_ID / GH_CLIENT_SECRET', { status: 500 });
  }

  // 2. code 换 access_token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'picture-gallery',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return new Response('换取 token 失败', { status: 502 });
  }
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return new Response('未获得 access_token', { status: 400 });
  }

  // 3. 查用户信息
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'picture-gallery',
    },
  });
  if (!userRes.ok) {
    return new Response('获取用户信息失败', { status: 502 });
  }
  const user = await userRes.json();
  const login = user.login;

  // 4. 校验是否允许的用户
  if (login !== ALLOWED_USER) {
    return new Response(`账号 ${login} 无权访问本图库`, { status: 403 });
  }

  // 5. 签发 session（7 天有效）
  const now = Date.now();
  const payload = {
    login,
    avatar: user.avatar_url,
    name: user.name || login,
    iat: now,
    exp: now + 7 * 24 * 60 * 60 * 1000,
  };
  const session = await signSession(payload, getSecret(env));

  // 6. 设 HttpOnly + Secure + SameSite cookie，跳回首页
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': [
        `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
        `pg_oauth_state=; Path=/; HttpOnly; Secure; Max-Age=0`, // 清掉 state
      ].join(', '),
    },
  });
}
