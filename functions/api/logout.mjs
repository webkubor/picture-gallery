// 登出：清除 session cookie
// GET /api/logout

import { SESSION_COOKIE } from '../_lib/auth.mjs';

export async function onRequestGet() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
