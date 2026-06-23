// 图片删除 API：支持 R2 和 PicX(GitHub) 两个后端
// - R2：直接 env.PICTURES_R2.delete(key)
// - GitHub：DELETE Contents API，需要 path + sha
// 鉴权：GitHub OAuth 登录态（cookie），只有 ALLOWED_USER 能删除

import { isAuthorized, jsonResponse, corsHeaders } from '../_lib/auth.mjs';

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// 处理 POST 删除请求
// body: { source: 'r2'|'github', key: path, sha?: githubBlobSha }
export async function onRequestPost({ request, env }) {
  // 1. OAuth 登录态校验
  if (!(await isAuthorized(request, env))) {
    return jsonResponse({ success: false, error: '未登录或无权限，请先 GitHub 登录' }, 401);
  }

  try {
    // 2. 解析 JSON body
    const { source, key, sha } = await request.json();

    if (!key || typeof key !== 'string') {
      return jsonResponse({ success: false, error: '缺少 key 字段' }, 400);
    }
    const src = source || 'r2';

    // 3. R2 删除：key 不存在时 R2 delete 不会报错，直接当成功
    if (src === 'r2') {
      await env.PICTURES_R2.delete(key);
      return jsonResponse({ success: true, backend: 'r2' });
    }

    // 4. GitHub 删除：调 Contents API DELETE，必须带 sha
    if (src === 'github') {
      const ghToken = env.GH_TOKEN || env.GITHUB_TOKEN;
      if (!ghToken) {
        return jsonResponse(
          { success: false, error: 'GitHub 删除未配置：缺少 GH_TOKEN / GITHUB_TOKEN' },
          500,
        );
      }
      if (!sha) {
        return jsonResponse(
          { success: false, error: 'GitHub 删除需要 sha（文件 blob 标识）' },
          400,
        );
      }

      const ghRes = await fetch(
        `https://api.github.com/repos/webkubor/picx-images-hosting/contents/${encodePath(key)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'picture-gallery',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `delete: ${key}`,
            sha,
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
      return jsonResponse({ success: true, backend: 'github' });
    }

    return jsonResponse({ success: false, error: `未知 source: ${src}` }, 400);
  } catch (err) {
    return jsonResponse(
      { success: false, error: String((err && err.message) || err) },
      500,
    );
  }
}
