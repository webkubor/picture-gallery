// 图片上传 API：支持 R2（Cloudflare 对象存储）和 PicX（GitHub 图床）两个后端
// 运行在 Cloudflare Pages Functions（边缘 Workers 环境）
// 鉴权：GitHub OAuth 登录态（cookie），只有 ALLOWED_USER 能上传

import { isAuthorized, jsonResponse, corsHeaders } from '../_lib/auth.mjs';

// 分段 encodeURIComponent 后用 / 拼回，保留路径分隔符
function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

// ArrayBuffer 转 base64（Cloudflare Workers 支持 btoa）
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// 处理 POST 上传请求
export async function onRequestPost({ request, env }) {
  // 1. OAuth 登录态校验
  if (!(await isAuthorized(request, env))) {
    return jsonResponse({ success: false, error: '未登录或无权限，请先 GitHub 登录' }, 401);
  }

  try {
    // 2. 解析 multipart/form-data
    const form = await request.formData();
    // 3. 取字段
    const file = form.get('file');
    const target = (form.get('target') || 'r2').toLowerCase();
    const path = (form.get('path') || '').trim();

    if (!file || typeof file === 'string') {
      return jsonResponse({ success: false, error: '缺少 file 字段' }, 400);
    }
    if (target !== 'r2' && target !== 'picx') {
      return jsonResponse({ success: false, error: 'target 必须为 r2 或 picx' }, 400);
    }

    // 4. 构造 key：path/filename（path 为空则根目录）
    const rawName = file.name || `upload-${Date.now()}`;
    const trimmedPath = path.replace(/^\/+|\/+$/g, '');

    // 5. 按 target 分发
    if (target === 'r2') {
      // R2：直接以 stream 写入对象存储；key = path/filename（保留原名）
      const r2Key = trimmedPath ? `${trimmedPath}/${rawName}` : rawName;
      await env.PICTURES_R2.put(r2Key, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
      const url = 'https://img.webkubor.online/' + encodePath(r2Key);
      return jsonResponse({ success: true, url, backend: 'r2', key: r2Key });
    }

    // PicX：读 ArrayBuffer → base64 → 调 GitHub Contents API PUT
    // 用登录用户的 OAuth token（放在 cookie 里的 session 不含 token，
    // 所以这里用服务器配置的 GH_TOKEN，需 repo 权限）
    const ghToken = env.GH_TOKEN || env.GITHUB_TOKEN;
    if (!ghToken) {
      return jsonResponse(
        { success: false, error: 'PicX 后端未配置：缺少 GH_TOKEN / GITHUB_TOKEN' },
        500,
      );
    }

    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);

    // PicX 加时间戳前缀避免重名覆盖
    const picxPath = trimmedPath || 'assets';
    const key = `${picxPath}/${Date.now()}-${rawName}`;

    const ghRes = await fetch(
      `https://api.github.com/repos/webkubor/picx-images-hosting/contents/${encodePath(key)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'picture-gallery',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `upload: ${key}`,
          content: base64,
          branch: 'master',
        }),
      },
    );

    if (!ghRes.ok) {
      const detail = await ghRes.text();
      return jsonResponse(
        { success: false, error: `GitHub API 失败: ${ghRes.status}`, detail },
        502,
      );
    }

    const url =
      'https://cdn.jsdelivr.net/gh/webkubor/picx-images-hosting@master/' + encodePath(key);
    return jsonResponse({ success: true, url, backend: 'picx', key });
  } catch (err) {
    return jsonResponse(
      { success: false, error: String((err && err.message) || err) },
      500,
    );
  }
}
