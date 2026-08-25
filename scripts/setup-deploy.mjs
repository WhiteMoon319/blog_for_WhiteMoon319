// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 一键部署向导：从零开始，对零基础小白友好。
// 逐步引导完成：依赖检查 → 登录 → 创建 D1/R2 → 配置 .env → 设置密钥 → 迁移 → 构建 → 部署。
// 使用：Windows 双击 setup.bat / Mac·Linux 运行 ./setup.sh（或 node scripts/setup-deploy.mjs）

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import readline from 'node:readline/promises';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const VER = '🔑';
const INFO = 'ℹ';
const OK = '✅';
const ERR = '❌';
const STEP = '🐾';

function run(cmd, opts = {}) {
  console.log(`\n  ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: process.cwd(), ...opts });
}

function runOut(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: process.cwd() }).toString();
}

async function ask(question, def = '') {
  const suffix = def ? ` [${def}]` : '';
  const ans = await rl.question(`${question}${suffix} `);
  return ans.trim() || def;
}

async function askSecret(question, confirm = false) {
  for (;;) {
    const a = await rl.question(`${question}（输入时不会显示） `);
    if (!a.trim()) { console.log(`${ERR} 不能为空，请重新输入`); continue; }
    if (!confirm) return a.trim();
    const b = await rl.question(`请再输入一次确认 `);
    if (a === b) return a.trim();
    console.log(`${ERR} 两次输入不一致，请重试`);
  }
}

function parseD1Id(out) {
  // "Created database 'blog-db' at edge" + 表格 database_id 列
  const m = out.match(/database_id[^\n]*?\|\s*([0-9a-f-]{36})/i);
  if (m) return m[1].trim();
  const m2 = out.match(/database_id[^\n]*?([0-9a-f]{32})/i);
  return m2 ? m2[1] : null;
}

function hasEnv() {
  return existsSync('.env');
}

async function ensureWranglerLoggedIn() {
  console.log(`\n${STEP} 检查 Cloudflare 登录状态…`);
  try {
    runOut('pnpm exec wrangler whoami');
    console.log(`${OK} 已登录`);
    return true;
  } catch {
    console.log(`\n${INFO} 尚未登录 Cloudflare。请在浏览器中打开授权页面，按提示登录你的 Cloudflare 账号。`);
    run('pnpm exec wrangler login');
    try {
      runOut('pnpm exec wrangler whoami');
      console.log(`${OK} 登录成功`);
      return true;
    } catch {
      console.log(`${ERR} 登录失败，请重试或手动执行 pnpm exec wrangler login`);
      return false;
    }
  }
}

async function setupD1() {
  console.log(`\n${STEP} 创建云数据库（D1）…`);
  let id = null;
  // 若已有 .env 的 BLOG_D1_ID，直接复用
  if (hasEnv()) {
    const envText = readFileSync('.env', 'utf8');
    const m = envText.match(/BLOG_D1_ID=([^\s]+)/);
    if (m) id = m[1].trim();
  }
  if (id) {
    console.log(`${OK} 复用已有 D1 ID：${id}`);
  } else {
    console.log(`${INFO} 正在创建数据库 blog-db…`);
    const out = runOut('pnpm exec wrangler d1 create blog-db --no-describe');
    id = parseD1Id(out);
    console.log(out);
    if (!id) {
      console.log(`${INFO} 未能自动解析 D1 ID，请手动运行 pnpm exec wrangler d1 list 查看完整 ID。`);
    }
  }
  return id;
}

async function setupR2() {
  console.log(`\n${STEP} 创建图片存储桶（R2）…`);
  try {
    runOut('pnpm exec wrangler r2 bucket list');
  } catch { /* ignore */ }
  console.log(`${INFO} 正在创建桶 blog-images（已存在则报错，可忽略）…`);
  try {
    runOut('pnpm exec wrangler r2 bucket create blog-images');
    console.log(`${OK} 桶已创建`);
  } catch {
    console.log(`${INFO} 桶可能已存在，继续…`);
  }
}

async function writeDotEnv(d1Id) {
  console.log(`\n${STEP} 生成 .env 配置文件 …`);
  if (!d1Id) {
    console.log(`${ERR} D1 ID 缺失，无法生成 .env`);
    return;
  }
  const content = `# 由部署向导自动生成。真实资源 ID 仅存本机，不入库。\nBLOG_D1_ID=${d1Id}\n`;
  if (hasEnv()) {
    const old = readFileSync('.env', 'utf8');
    if (old.includes('BLOG_D1_ID=')) {
      writeFileSync('.env', old.replace(/BLOG_D1_ID=.*/, `BLOG_D1_ID=${d1Id}`));
    } else {
      appendFileSync('.env', content);
    }
  } else {
    writeFileSync('.env', content);
  }
  console.log(`${OK} .env 已写好（BLOG_D1_ID=${d1Id}）`);
}

async function setupSecrets() {
  console.log(`\n${STEP} 设置生产密钥（Secret）…`);
  console.log(`${INFO} 以下是各密钥的说明。若没有对应用途可留空跳过（但 BLOG_ADMIN_PASSWORD 必须设置）。`);

  const secrets = [
    { name: 'BLOG_ADMIN_PASSWORD', desc: '管理员登录密码（必须，≥8 位）', required: true },
    { name: 'BLOG_SESSION_SECRET', desc: '会话签名密钥（32 字节以上随机串）', required: true },
    { name: 'AI_SETTINGS_ENCRYPTION_KEY', desc: 'AI Key/邮件凭据加密主密钥（64 位十六进制，可用下方生成）', required: false },
    { name: 'SMTP_USER', desc: 'SMTP 发件邮箱（如 3287047638@qq.com）', required: false },
    { name: 'SMTP_PASS', desc: 'SMTP 授权码（QQ 邮箱需在设置中生成）', required: false },
    { name: 'SMTP_FROM', desc: '发件显示地址（通常同 SMTP_USER）', required: false },
  ];

  const skipAll = await ask(`是否现在设置所有密钥？(y=全部设置 / n=跳过到下一步）`, 'y') !== 'n';

  for (const s of secrets) {
    if (!skipAll) { console.log(`${INFO} 跳过 ${s.name}`); continue; }
    console.log(`\n  ${INFO} ${s.name} — ${s.desc}`);
    if (s.name === 'AI_SETTINGS_ENCRYPTION_KEY') {
      const use = await ask(`手动输入还是自动生成随机密钥？(m=手动 / g=生成）`, 'g');
      let val;
      if (use === 'g') {
        val = runOut("node -e \"process.stdout.write(require('crypto').randomBytes(32).toString('hex'))\"").trim();
        console.log(`${INFO} 已生成随机密钥（不会回显，直接写入）`);
      } else {
        val = await askSecret('请输入加密主密钥（64 位十六进制）');
      }
      execSync(`printf '%s' "${val}" | pnpm exec wrangler secret put ${s.name}`, { stdio: 'inherit' });
      continue;
    }
    const val = await askSecret(`请输入 ${s.name}（留空则跳过）`);
    if (val) {
      run(`echo "${val}" | pnpm exec wrangler secret put ${s.name}`);
    } else {
      console.log(`${INFO} 跳过 ${s.name}`);
    }
  }
}

async function migrate() {
  console.log(`\n${STEP} 应用数据库迁移 + 种子…`);
  run('pnpm exec wrangler d1 migrations apply blog-db --remote');
  const seed = await ask('是否导入演示种子数据？(y/n）', 'n');
  if (seed === 'y') {
    run('pnpm exec wrangler d1 execute blog-db --remote --file=db/seed.sql');
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(` ${VER}  月下独酌 · 一键部署向导`);
  console.log(`${'='.repeat(60)}`);
  console.log(`${INFO} 本向导将引导你从零把博客部署到 Cloudflare。整个过程约 5-10 分钟。`);
  console.log(`${INFO} 如果你看到这一步，说明 Node.js 和 pnpm 已安装 ✅`);

  console.log(`\n${STEP} 安装依赖…`);
  if (!existsSync('node_modules')) {
    run('pnpm install');
  } else {
    console.log(`${OK} node_modules 已存在，跳过安装`);
  }

  if (!await ensureWranglerLoggedIn()) return;

  const d1Id = await setupD1();
  await setupR2();
  await writeDotEnv(d1Id);
  await setupSecrets();

  console.log(`\n${STEP} 生成部署配置…`);
  run('pnpm -C admin install');
  run('pnpm exec wrangler d1 execute blog-db --remote --file=db/reset.sql && pnpm exec wrangler d1 migrations apply blog-db --remote');

  await migrate();

  console.log(`\n${STEP} 构建并部署…`);
  run('pnpm run deploy');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${OK}  部署完成！`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  前台：https://<你的域名>/`);
  console.log(`  后台：https://<你的域名>/admin/`);
  console.log(`  管理员账号：admin（密码为刚才设置的 BLOG_ADMIN_PASSWORD）`);
  console.log(`\n${INFO} 接下来（后台设置页）：`);
  console.log(`  1. 邮件(SMTP)：填入 smtp.qq.com、端口 465、QQ 邮箱、授权码，点「测试并保存」`);
  console.log(`  2. AI 摘要：配置服务商 / API Key / 模型（若使用）`);
  console.log(`  3. 写完文章后可到数据看板查看统计`);
  rl.close();
}

main().catch((e) => {
  console.error(`${ERR} 部署过程中出错：`, e);
  rl.close();
  process.exit(1);
});