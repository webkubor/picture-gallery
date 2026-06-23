// 鉴权工具：GitHub OAuth 登录态管理（签名 cookie）
// 被 login/callback/logout/me/upload/delete 共享

// 允许操作的 GitHub 用户名（只有本账号能上传/删除）
export const ALLOWED_USER = 'webkubor';

// cookie 名
export const SESSION_COOKIE = 'pg_session';

// 拿签名密钥（Cloudflare Pages Secret: SESSION_SECRET）
export function getSecret(env) {
  const s = env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET 未配置');
  return s;
}

// ---------- base64url 编解码（工具，Workers 原生支持 btoa/atob）----------

function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToB64url(str) {
  return bytesToB64url(new TextEncoder().encode(str));
}

function b64urlToBytes(b64) {
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------- HMAC 签名（Web Crypto API）----------

async function hmacKey(secret) {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// 生成签名 session token：base64url(payload).base64url(hmac(payload))
export async function signSession(payload, secret) {
  const dataStr = JSON.stringify(payload);
  const dataB64 = strToB64url(dataStr);
  const key = await hmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataStr));
  const sigB64 = bytesToB64url(new Uint8Array(sigBuf));
  return `${dataB64}.${sigB64}`;
}

// 验证并解析 session token；无效返回 null
export async function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [dataB64, sigB64] = parts;

  let dataStr;
  try {
    dataStr = new TextDecoder().decode(b64urlToBytes(dataB64));
  } catch {
    return null;
  }

  // 用 Web Crypto 验证签名（恒定时间）
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(dataStr),
  );
  if (!ok) return null;

  try {
    const payload = JSON.parse(dataStr);
    // 过期检查（7 天）
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// 从请求 cookie 解析出 session 并验证，返回 payload 或 null
export async function getSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  try {
    return await verifySession(match[1], getSecret(env));
  } catch {
    return null;
  }
}

// 判断当前请求是否已登录且是允许的用户
export async function isAuthorized(request, env) {
  const session = await getSession(request, env);
  return Boolean(session && session.login === ALLOWED_USER);
}

// CORS 头
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
};

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}
