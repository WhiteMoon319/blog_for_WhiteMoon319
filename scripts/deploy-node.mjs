// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================================
// Node 目标部署：本地构建 → 上传 → 远端初始化
// ============================================================================
// 为什么必须本地构建：
//   Vite 打包 PostEditorView（单 chunk 1.25MB）时 Node 堆峰值很高。实测 1.9G 内存
//   的机器会直接 OOMErrorHandler 退出（exit 134）。所以构建一律在本机做，
//   远端只接收产物。联网传时用 tar 流，不依赖 rsync（Windows 上没有）。
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Remote, ensureKeyPair, installPubkey, verifyKeyLogin, saveDeployState } from './remote.mjs';
import { randomBytes } from 'node:crypto';

const OK = '✅';
const ERR = '❌';
const INFO = 'ℹ';
const STEP = '🐾';

/** 远端探测：一次性把需要的信息全拿回来，少开几次连接 */
export function probeRemote(remote) {
  // 注意：脚本经 base64 传给远端 bash，本地不再做一层转义，$VAR 直接用
  const out = remote.probe(`
    echo "ARCH=$(uname -m)"
    echo "OS=$( . /etc/os-release 2>/dev/null && echo $ID || echo unknown )"
    echo "OSVER=$( . /etc/os-release 2>/dev/null && echo $VERSION_ID || echo 0 )"
    echo "MEM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')"
    echo "NODE=$(command -v node || echo none)"
    echo "NODEV=$(node -v 2>/dev/null || echo none)"
    echo "PNPM=$(command -v pnpm || echo none)"
    echo "NGINX=$(command -v nginx || echo none)"
    echo "SYSTEMD=$(command -v systemctl >/dev/null 2>&1 && echo yes || echo no)"
    echo "SUDO=$(sudo -n true 2>/dev/null && echo nopasswd || echo prompt)"
    echo "CERTBOT=$(command -v certbot || echo none)"
  `);
  const kv = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  // NODEV 拼进 NODE 展示，省一个字段
  if (kv.NODEV && kv.NODEV !== 'none') kv.NODE = `${kv.NODE} (${kv.NODEV})`;
  return kv;
}

/** 远端是否已有正在服务的 nginx 站点（决定能不能自动装/改配置） */
export function nginxInUse(remote) {
  const out = remote.probe(`
    ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -v default | head -5
    echo "---"
    ss -lntp 2>/dev/null | grep -E ':(80|443)\\s' | wc -l
  `);
  const [sites, ports] = out.split('---').map((s) => s.trim());
  return { sites: sites ? sites.split('\n').filter(Boolean) : [], portCount: Number(ports) || 0 };
}

/**
 * 本地构建。只构建 Node 目标需要的三套产物。
 * @param {string} root 仓库根目录
 * @param {(msg: string) => void} log
 */
export function buildLocal(root, log) {
  if (!existsSync(join(root, 'node_modules'))) {
    throw new Error('node_modules 不存在，请先运行 pnpm install');
  }
  const env = { ...process.env, BLOG_TARGET: 'node' };
  const steps = [
    ['复制 vendor CSS', 'node scripts/copy-vendor-css.mjs'],
    ['构建后台（admin + write）', 'pnpm -C admin run build'],
    ['构建 Astro 服务端', 'astro build'],
    ['合并后台产物', 'node scripts/merge-admin.mjs'],
  ];
  for (const [label, cmd] of steps) {
    log(`${STEP} ${label}`);
    execSync(cmd, { cwd: root, stdio: 'inherit', env });
  }
  if (!existsSync(join(root, 'dist', 'server', 'entry.mjs'))) {
    throw new Error('构建产物缺失：dist/server/entry.mjs');
  }
}

/**
 * 组装待上传的目录。只带运行时需要的，不带 node_modules / 源码 / .env。
 * @param {string} root
 * @returns {string} 临时目录
 */
export function packPayload(root) {
  const out = join(tmpdir(), `bwm-deploy-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  for (const item of ['dist', 'server', 'db']) {
    const src = join(root, item);
    if (existsSync(src)) cpSync(src, join(out, item), { recursive: true });
  }
  // 运行时需要 package.json 判定 type=module；只取最小字段集
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(
    join(out, 'package.json'),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        private: true,
        type: pkg.type || 'module',
        scripts: { start: 'node server/index.mjs', migrate: 'node server/migrate.mjs' },
      },
      null,
      2,
    ),
  );
  // server 侧用到的生产依赖
  const runtimeDeps = ['@astrojs/node', 'astro', 'nodemailer', 'sanitize-html'];
  const deps = {};
  for (const d of runtimeDeps) if (pkg.dependencies?.[d]) deps[d] = pkg.dependencies[d];
  const p = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'));
  p.dependencies = deps;
  writeFileSync(join(out, 'package.json'), JSON.stringify(p, null, 2));
  return out;
}

/**
 * 远端初始化：解包 → 装依赖 → 迁移 → systemd → 启动。
 * @param {Remote} remote
 * @param {{ remoteDir: string, appDir: string, port: number, siteUrl: string,
 *           adminPassword: string, sessionSecret: string, fontsBase?: string }} cfg
 */
export function initRemote(remote, cfg) {
  const { appDir, port, siteUrl, adminPassword, sessionSecret, fontsBase } = cfg;
  const envFile = [
    `SITE_URL=${siteUrl}`,
    `PORT=${port}`,
    `NODE_ENV=production`,
    `BLOG_TARGET=node`,
    fontsBase ? `FONTS_BASE=${fontsBase}` : '',
    `BLOG_ADMIN_PASSWORD=${adminPassword}`,
    `BLOG_SESSION_SECRET=${sessionSecret}`,
    `EDGE_CACHE=false`,
    `HTTPS_REDIRECT=false`,
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  remote.exec(`mkdir -p ${appDir}/data ${appDir}/logs`, { label: '创建目录' });
  remote.writeRemoteFile(`${appDir}/.env`, envFile);
  remote.exec(`chmod 600 ${appDir}/.env`, { label: '收紧 .env 权限' });

  remote.exec(`cd ${appDir} && (pnpm install --prod --ignore-scripts 2>&1 | tail -3)`, {
    label: '安装运行时依赖',
    stdio: 'inherit',
  });

  remote.exec(`cd ${appDir} && node server/migrate.mjs 2>&1 | tail -5`, {
    label: '应用数据库迁移',
    stdio: 'inherit',
  });

  const unit = `[Unit]
Description=blog (Node)
After=network.target

[Service]
Type=simple
User=${cfg.runUser}
WorkingDirectory=${appDir}
Environment=NODE_ENV=production
Environment=BLOG_TARGET=node
EnvironmentFile=${appDir}/.env
ExecStart=$(command -v node 2>/dev/null || echo /usr/bin/node) server/index.mjs
Restart=always
RestartSec=3
StandardOutput=append:${appDir}/logs/server.log
StandardError=append:${appDir}/logs/server.log

[Install]
WantedBy=multi-user.target
`;
  remote.writeRemoteFile('/tmp/bwm.service', unit);
  remote.exec(
    `sudo -n mv /tmp/bwm.service /etc/systemd/system/bwm.service && sudo -n systemctl daemon-reload && sudo -n systemctl enable bwm && sudo -n systemctl restart bwm`,
    { label: '注册并启动 systemd 服务' },
  );

  // 健康检查：给进程一点启动时间
  for (let i = 0; i < 20; i++) {
    const r = remote.probe(`curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/__health`);
    if (r.trim() === '200') return true;
    execSync('sleep 2');
  }
  throw new Error(`服务未在预期时间内就绪（/__health 未返回 200），请查看 ${appDir}/logs/server.log`);
}

/**
 * 远端 nginx 配置。
 * 已有站点时只写配置文件不启用，交给用户自己 ln -s——避免打断别人的站。
 */
export function setupNginx(remote, cfg) {
  const { domain, port, email, useSsl } = cfg;
  const conf = `# 由 bwm 部署向导生成
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    # ACME 校验必须在上面的 301 之前命中，否则证书续期必失败
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        client_max_body_size 20m;
        proxy_buffering off;
    }
}
`;
  remote.writeRemoteFile('/tmp/bwm-site.conf', conf);
  remote.exec(
    `sudo -n mv /tmp/bwm-site.conf /etc/nginx/sites-available/bwm && sudo -n ln -sf /etc/nginx/sites-available/bwm /etc/nginx/sites-enabled/bwm && sudo -n nginx -t`,
    { label: '写入 nginx 站点配置' },
  );

  // gzip：默认 gzip_proxied off + gzip_types 只含 text/html，反代响应会整份裸传
  remote.exec(
    `sudo -n mkdir -p /etc/nginx/conf.d && printf '%s\\n' 'gzip on;' 'gzip_vary on;' 'gzip_proxied any;' 'gzip_comp_level 6;' 'gzip_min_length 1024;' 'gzip_types text/plain text/css text/javascript application/javascript application/json application/xml image/svg+xml application/manifest+json;' | sudo -n tee /etc/nginx/conf.d/bwm-gzip.conf >/dev/null`,
    { label: '补全 gzip（反代必需）' },
  );

  if (!useSsl) {
    remote.exec('sudo -n nginx -t && sudo -n systemctl reload nginx', { label: '重载 nginx' });
    return { ssl: false };
  }

  // SSL：先验解析，避免 certbot 打空靶并触发速率限制
  const resolved = remote.probe(`getent hosts ${domain} | awk '{print $1}' | head -3`);
  const serverIp = remote.probe(`curl -s --max-time 5 https://api.ipify.org || echo unknown`);
  const hit = resolved
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!hit.includes(serverIp.trim())) {
    return {
      ssl: false,
      warning: `域名 ${domain} 未解析到本机 ${serverIp.trim()}（当前解析：${hit.join(', ') || '无'}）。已跳过证书签发，解析生效后可运行：sudo certbot --nginx -d ${domain}`,
    };
  }

  remote.exec(
    `sudo -n mkdir -p /var/www/html && ` +
      `if ! command -v certbot >/dev/null; then ` +
      `  . /etc/os-release; case "$ID" in ` +
      `    ubuntu|debian) sudo -n apt-get install -y -q certbot python3-certbot-nginx ;; ` +
      `    centos|rhel|fedora|rocky|almalinux) sudo -n dnf install -y certbot python3-certbot-nginx ;; ` +
      `    *) echo "未知发行版，请手动安装 certbot" >&2; exit 1 ;; ` +
      `  esac; fi`,
    { label: '确保 certbot 可用', stdio: 'inherit' },
  );

  remote.exec(
    `sudo -n certbot --nginx -d ${domain} --non-interactive --agree-tos --redirect --email ${email} 2>&1 | tail -12`,
    { label: '签发证书并开启 80→443 跳转', stdio: 'inherit' },
  );

  remote.exec('sudo -n systemctl reload nginx', { label: '重载 nginx' });
  return { ssl: true };
}

/** 生成随机口令，避免用户自己想 */
export function genSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export { Remote, ensureKeyPair, installPubkey, verifyKeyLogin, saveDeployState, OK, ERR, INFO, STEP, rmSync };
