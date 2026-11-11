// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================================
// Node 目标向导：本机运行 或 远程服务器
// ============================================================================
// 与 cf 向导共用 readline 与断点续传基础设施（由调用方注入）。
// 所有交互都走 ask()，方便统一测试与统一的输入体验。
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { Remote, ensureKeyPair, installPubkey, verifyKeyLogin, saveDeployState, STATE_DIR } from './remote.mjs';
import { probeRemote, nginxInUse, buildLocal, packPayload, initRemote, setupNginx, genSecret } from './deploy-node.mjs';

const OK = '✅';
const ERR = '❌';
const INFO = 'ℹ';
const STEP = '🐾';

/**
 * 装依赖。发布包是 git archive 打出来的源码，不含 node_modules，
 * 而 buildLocal 上手就要求 node_modules 存在，所以这一步必须在构建之前。
 * 用 --frozen-lockfile 保证装出来的版本与发布时一致；有 pnpm 就用 pnpm，
 * 没有则退回 npm（with-env 包里 pnpm 一定在，PATH 由 setup 脚本配好）。
 */
function installDeps(root) {
  if (existsSync(join(root, 'node_modules'))) {
    console.log(`  ${INFO} node_modules 已存在，跳过安装`);
    return;
  }
  const hasPnpm = (() => {
    try {
      execSync('pnpm -v', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  const cmd = hasPnpm ? 'pnpm install --frozen-lockfile' : 'npm ci';
  console.log(`  ${STEP} ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

/** 本机模式：构建 → 迁移 → 前台启动 */
export async function runLocal(ctx) {
  const { ask, askSecret, guard, root } = ctx;

  const port = await ask('应用监听端口（本机专用，别和已有服务冲突）', '8020');
  const siteUrl = await ask('站点访问地址（浏览器里输入的完整地址）', `http://localhost:${port}`);

  let adminPassword = await ask('管理员（admin）密码', genSecret(12));
  const sessionSecret = genSecret(32);

  await guard('node-deps', '安装依赖', () => {
    installDeps(root);
  });

  await guard('node-build', '构建（本地）', () => {
    buildLocal(root, (m) => console.log(`  ${m}`));
  });

  await guard('node-env', '写入 .env', () => {
    const lines = [
      `SITE_URL=${siteUrl}`,
      `PORT=${port}`,
      `NODE_ENV=production`,
      `BLOG_TARGET=node`,
      `BLOG_ADMIN_PASSWORD=${adminPassword}`,
      `BLOG_SESSION_SECRET=${sessionSecret}`,
      `EDGE_CACHE=false`,
      `HTTPS_REDIRECT=false`,
      '',
    ];
    writeFileSync(join(root, '.env'), lines.join('\n'), { mode: 0o600 });
    console.log(`  ${OK} 已写 .env（600）`);
  });

  await guard('node-migrate', '应用数据库迁移', () => {
    execSync('node server/migrate.mjs', { cwd: root, stdio: 'inherit' });
  });

  console.log(`\n${OK} 准备就绪。启动命令：`);
  console.log(`  cd ${root}`);
  console.log(`  BLOG_TARGET=node pnpm start`);
  console.log(`\n  然后访问 ${siteUrl}`);
  console.log(`  后台 ${siteUrl}/admin/ ，账号 admin / ${adminPassword}`);
  console.log(`\n${INFO} 想改成开机自启，可参考 README 的 systemd 一节。`);
}

/** 远程模式：探测 → 装公钥 → 上传 → 初始化 → nginx → SSL */
export async function runRemote(ctx) {
  const { ask, askSecret, guard, root } = ctx;

  // ---------- 1. 连接信息 ----------
  const host = await ask('服务器地址（IP 或域名）');
  const sshPort = await ask('SSH 端口', '22');
  const sshUser = await ask('SSH 用户名', 'root');

  console.log(`\n${INFO} 先用密码登录一次来安装公钥，之后的步骤都免密。`);
  console.log(`  ${INFO} 密码由 ssh 自己提示，脚本不读取、不保存。`);

  const key = ensureKeyPair();
  await guard('node-pubkey', '安装部署公钥', () => {
    installPubkey({ host, port: Number(sshPort), user: sshUser }, key.pubBody);
  });

  const remote = new Remote({ host, port: Number(sshPort), user: sshUser, keyPath: key.priv });
  if (!verifyKeyLogin(remote)) {
    throw new Error('公钥已装但免密登录未生效，请检查远端 ~/.ssh/authorized_keys 与权限（700/600）');
  }
  console.log(`  ${OK} 免密登录已验证`);

  // ---------- 2. 远端环境探测 ----------
  let env;
  await guard('node-probe', '探测远端环境', () => {
    env = probeRemote(remote);
    const memMb = Number(env.MEM_MB) || 0;
    console.log(`  ${OK} ${env.OS} ${env.OSVER} / ${env.ARCH} / 内存 ${memMb}MB`);
    console.log(`  node: ${env.NODE}`);
    console.log(`  pnpm: ${env.PNPM}`);
    console.log(`  nginx: ${env.NGINX}`);
    console.log(`  systemd: ${env.SYSTEMD}`);
    if (env.SYSTEMD !== 'yes') {
      throw new Error('远端没有 systemd，本向导依赖它托管服务。可改用手动启动（见 README）。');
    }
    if (env.SUDO !== 'nopasswd') {
      console.log(`  ${INFO} sudo 需要密码：请先为该用户配置 NOPASSWD，或后续步骤手动执行。`);
    }
    if (env.PNPM === 'none') {
      throw new Error('远端没有 pnpm。请先安装：npm i -g pnpm（并确保在 PATH 里）');
    }
    if (env.NODE === 'none') {
      throw new Error('远端没有 node。请先安装 Node ≥ 22（需要 node:sqlite）。');
    }
    // node 版本必须 ≥ 22
    const m = /v(\d+)/.exec(env.NODE);
    if (m && Number(m[1]) < 22) {
      throw new Error(`远端 node 是 v${m[1]}，需要 ≥ 22（node:sqlite 依赖）`);
    }
    if (memMb && memMb < 1024) {
      console.log(`  ${INFO} 内存偏小（${memMb}MB）。本向导不在远端构建，只装运行时依赖，通常够用。`);
    }
  });

  // ---------- 3. nginx 现状 ----------
  const ngin = nginxInUse(remote);
  let manageNginx = true;
  if (ngin.sites.length > 0 || ngin.portCount > 0) {
    console.log(`\n${INFO} 该机器上已有 nginx 站点：${ngin.sites.join(', ') || '（端口 80/443 已被占用）'}`);
    console.log(`  ${INFO} 为避免打断现有站点，本次只写入配置文件，不自动启用。`);
    manageNginx = false;
  }

  // ---------- 4. 应用参数 ----------
  const domain = await ask('域名（没域名直接回车，用 IP:端口 访问）', '');
  const appPort = await ask('应用端口（仅本机监听）', '8020');
  const appDir = await ask('远端安装目录', `/home/${sshUser}/bwm`);
  const siteUrl = domain ? `https://${domain}` : `http://${host}:${appPort}`;

  const defaultPwd = genSecret(12);
  const adminPassword = await ask('管理员（admin）密码', defaultPwd);
  const sessionSecret = genSecret(32);

  let fontsBase = '';
  if (domain) {
    const useFonts = await ask('字体走独立静态域名？（y/n，跳过则跟随主站）', 'n');
    if (useFonts.toLowerCase() === 'y') {
      fontsBase = await ask('字体站点地址', `https://static.${domain}`);
    }
  }

  // ---------- 5. 本地依赖与构建 ----------
  await guard('node-deps', '安装依赖', () => {
    installDeps(root);
  });

  await guard('node-build', '本地构建', () => {
    buildLocal(root, (m) => console.log(`  ${m}`));
  });

  // ---------- 6. 上传 ----------
  await guard('node-upload', '上传产物', () => {
    const payload = packPayload(root);
    remote.exec(`rm -rf ${appDir}/dist ${appDir}/server ${appDir}/db ${appDir}/package.json`, {
      allowFail: true,
    });
    remote.upload(payload, appDir);
    execSync(`rm -rf "${payload}"`, { stdio: 'ignore' });
    console.log(`  ${OK} 已上传到 ${appDir}`);
  });

  // ---------- 7. 远端初始化 ----------
  await guard('node-init', '初始化并启动服务', () => {
    initRemote(remote, {
      appDir,
      port: Number(appPort),
      siteUrl,
      adminPassword,
      sessionSecret,
      fontsBase,
      runUser: sshUser,
    });
    console.log(`  ${OK} /__health 返回 200`);
  });

  // ---------- 8. nginx + SSL ----------
  let nginxResult = null;
  if (domain) {
    const wantSsl = (await ask('现在签发 HTTPS 证书？（y/n，需要域名已解析到本机）', 'y')).toLowerCase() === 'y';
    const email = wantSsl ? await ask('证书到期通知邮箱') : '';
    await guard('node-nginx', '配置 nginx' + (wantSsl ? ' + HTTPS' : ''), () => {
      nginxResult = setupNginx(remote, {
        domain,
        port: Number(appPort),
        email,
        useSsl: wantSsl,
      });
      if (nginxResult.warning) console.log(`  ${INFO} ${nginxResult.warning}`);
      else if (nginxResult.ssl) console.log(`  ${OK} 证书已签发，80 已跳转 443`);
    });
    if (!manageNginx) {
      console.log(`\n${INFO} 已写入 /etc/nginx/sites-available/bwm，但未启用（检测到已有站点）。`);
      console.log(
        `  ${INFO} 确认不冲突后手动启用：sudo ln -s /etc/nginx/sites-available/bwm /etc/nginx/sites-enabled/bwm && sudo nginx -s reload`,
      );
    }
  }

  // ---------- 9. 记录 ----------
  await guard('node-state', '保存部署记录', () => {
    const file = saveDeployState(host, {
      host,
      sshPort: Number(sshPort),
      user: sshUser,
      keyPath: key.priv,
      appDir,
      appPort: Number(appPort),
      domain,
      siteUrl,
      deployedAt: new Date().toISOString(),
    });
    console.log(`  ${OK} ${file}（只记录主机与路径，不含密码）`);
  });

  // ---------- 10. 汇总 ----------
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${OK}  部署完成`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  站点：${siteUrl}`);
  console.log(`  后台：${siteUrl}/admin/`);
  console.log(`  账号：admin / ${adminPassword}`);
  console.log(`\n${INFO} 常用命令：`);
  console.log(`  重启：ssh ${sshUser}@${host} 'sudo systemctl restart bwm'`);
  console.log(`  日志：ssh ${sshUser}@${host} 'tail -f ${appDir}/logs/server.log'`);
  console.log(`  更新：重新运行本向导，会重新构建并覆盖上传`);
  if (!nginxResult?.ssl && domain) {
    console.log(`\n${INFO} HTTPS 未启用。域名解析生效后补签：`);
    console.log(`  ssh ${sshUser}@${host} 'sudo certbot --nginx -d ${domain}'`);
  }
}
