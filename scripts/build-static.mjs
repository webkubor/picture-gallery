// 构建脚本：把静态资源复制到 dist/，产物只含线上需要的文件
// index.html + css/ + js/ + data/ + favicon.svg

import { cp, mkdir, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const copied = [];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir('dist', { recursive: true });

  // index.html
  if (await exists('index.html')) {
    await copyFile('index.html', 'dist/index.html');
    copied.push('index.html');
  }

  // favicon.svg
  if (await exists('favicon.svg')) {
    await copyFile('favicon.svg', 'dist/favicon.svg');
    copied.push('favicon.svg');
  }

  // 目录（递归复制）
  for (const dir of ['css', 'js', 'data']) {
    if (existsSync(dir)) {
      await cp(dir, `dist/${dir}`, { recursive: true });
      copied.push(`${dir}/`);
    }
  }

  console.log(`✅ 构建完成，已复制到 dist/：`);
  for (const c of copied) console.log(`   - ${c}`);
}

main().catch((error) => {
  console.error('❌ 构建失败:', error.message);
  process.exitCode = 1;
});
