// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================================
// 远程主机操作封装（Node 目标部署用）
// ============================================================================
// 设计约束：
// 1) 只用系统自带的 OpenSSH 客户端，不引第三方依赖——ssh2 这类库要编译原生
//    模块，在用户的 Windows 机器上大概率装不上，而 OpenSSH 现在三个平台都有。
// 2) 不使用 sshpass。它在 Windows / macOS 默认都没有，Linux 也要另装。
//    密码登录只用于「把公钥推上去」这一次，之后一律走密钥。
// 3) 推公钥的做法：ssh 的密码提示读的是 /dev/tty，不占 stdin，
//    所以可以把公钥从 stdin 灌进远端的 authorized_keys，同时让 ssh 自己弹密码。
//    这一招在 Windows / macOS / Linux 行为一致。
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const IS_WIN = platform() === 'win32';

/** 统一的配置存放目录：不放进项目里，避免连密码/主机信息被 git 带走 */
export const STATE_DIR = join(homedir(), '.bwm');

/**
 * 规范化一条要丢给远端 shell 的命令。
 * Windows 下 ssh.exe 会把参数原样拼给远端，直接传多行/引号很容易被 cmd 二次解析，
 * 所以统一用 base64 传输再在远端解开，彻底绕开各平台 shell 的引号差异。
 * @param {string} script 远端要执行的 bash 脚本
 * @returns {string}
 */
function wrapScript(script) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `echo ${b64} | base64 -d | bash -s`;
}

export class Remote {
  /**
   * @param {{ host: string, port?: number, user: string, keyPath?: string, password?: boolean }} opts
   */
  constructor(opts) {
    this.host = opts.host;
    this.port = opts.port || 22;
    this.user = opts.user;
    this.keyPath = opts.keyPath || null;
  }

  get target() {
    return `${this.user}@${this.host}`;
  }

  /** ssh 公共参数：强制非交互式但保留 tty（sudo 与首次密码提示都需要） */
  get baseArgs() {
    const args = [
      '-p', String(this.port),
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `ConnectTimeout=15`,
      '-o', 'ServerAliveInterval=15',
      '-o', 'LogLevel=ERROR',
    ];
    if (this.keyPath) args.push('-i', this.keyPath, '-o', 'IdentitiesOnly=yes');
    return args;
  }

  /**
   * 执行远端命令。
   * @param {string} script 远端 bash 脚本
   * @param {{ stdio?: 'inherit'|'pipe', label?: string, allowFail?: boolean, sudo?: boolean }} [opts]
   * @returns {{ ok: boolean, out: string, code: number }}
   */
  exec(script, opts = {}) {
    const body = opts.sudo ? `sudo -n bash -c ${JSON.stringify(script)}` : wrapScript(script);
    if (opts.label) console.log(`\n  \x1b[2m[${this.host}]\x1b[0m ${opts.label}`);
    const r = spawnSync('ssh', [...this.baseArgs, this.target, body], {
      stdio: opts.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0 && !opts.allowFail) {
      const err = new Error(`远端命令失败（${r.status}）：${script.slice(0, 120)}`);
      err.output = out;
      throw err;
    }
    return { ok: r.status === 0, out: out.trim(), code: r.status ?? -1 };
  }

  /** 执行并返回标准输出（失败返回空串，用于探测） */
  probe(script) {
    try {
      return this.exec(script, { allowFail: true }).out;
    } catch {
      return '';
    }
  }

  /**
   * 上传目录（tar 流式传输，不依赖 rsync——Windows 上没有）。
   *
   * 关键点：tar 是二进制，**不能**像普通命令那样 base64 包一层走 `bash -s`，
   * 否则 tar 的字节会被 bash 当脚本解析。这里直接让远端 `tar -xf -` 读 stdin。
   * @param {string} localPath 本地目录
   * @param {string} remotePath 远端目标目录
   */
  upload(localPath, remotePath) {
    const tar = IS_WIN ? 'tar.exe' : 'tar';
    // 远端只做解包，不接受任何来自本地的脚本内容
    const remoteCmd = `mkdir -p ${remotePath} && tar -xf - -C ${remotePath}`;
    const child = spawnSync(
      'ssh',
      [...this.baseArgs, this.target, remoteCmd],
      {
        input: execSync(`${tar} -cf - -C "${localPath}" .`, {
          maxBuffer: 1024 * 1024 * 512,
          stdio: ['ignore', 'pipe', 'inherit'],
        }),
        stdio: ['pipe', 'inherit', 'inherit'],
      },
    );
    if (child.status !== 0) throw new Error(`上传失败：${localPath} → ${remotePath}`);
  }

  /** 传一段文本到远端文件（走 stdin，避免转义地狱） */
  writeRemoteFile(remotePath, content, opts = {}) {
    const script = opts.sudo
      ? `sudo -n tee ${remotePath} >/dev/null`
      : `cat > ${remotePath}`;
    const r = spawnSync('ssh', [...this.baseArgs, this.target, script], {
      input: content,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (r.status !== 0) throw new Error(`写入远端文件失败：${remotePath}`);
  }
}

/**
 * 确保本地存在一对部署用密钥；没有就生成。
 * 单独放一个 key，不复用用户自己的 ~/.ssh/id_rsa——避免部署流程动到既有密钥。
 * @returns {{ priv: string, pub: string, pubBody: string }}
 */
export function ensureKeyPair() {
  mkdirSync(STATE_DIR, { recursive: true });
  const priv = join(STATE_DIR, 'deploy_key');
  const pub = `${priv}.pub`;
  if (!existsSync(priv)) {
    console.log('  生成部署专用 SSH 密钥（不影响你已有的密钥）…');
    execSync(
      `ssh-keygen -t ed25519 -N "" -C "bwm-deploy" -f "${priv}"`,
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    try {
      chmodSync(priv, 0o600);
    } catch {
      // Windows 上 chmod 语义有限，忽略
    }
  }
  return { priv, pub, pubBody: readFileSync(pub, 'utf8').trim() };
}

/**
 * 把公钥装到远端。
 * 先用密码走一次（ssh 自己弹密码，读 /dev/tty，不占 stdin），
 * 装好之后该主机就能免密登录了。
 * @param {{ host: string, port?: number, user: string }} opts
 * @param {string} pubBody
 */
export function installPubkey(opts, pubBody) {
  const args = [
    '-p', String(opts.port || 22),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    '-o', 'PreferredAuthentications=password,keyboard-interactive',
    '-o', 'PubkeyAuthentication=no',
    `${opts.user}@${opts.host}`,
    // 幂等追加：已存在就跳过，避免 authorized_keys 越滚越长
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '${pubBody}' ~/.ssh/authorized_keys || echo '${pubBody}' >> ~/.ssh/authorized_keys`,
  ];
  console.log('\n  接下来会提示输入该服务器的登录密码（由 ssh 自己处理，脚本不会记录）');
  const r = spawnSync('ssh', args, { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(
      '公钥安装失败。请确认：主机地址/端口/用户名正确，密码可登录，且远端允许密码认证。',
    );
  }
}

/** 用密钥验证免密是否真的通了 */
export function verifyKeyLogin(remote) {
  const r = remote.exec('echo BWM_OK', { allowFail: true });
  return r.out.includes('BWM_OK');
}

/**
 * 读取/写入本机的部署记录（600 权限）。
 * 只存主机、端口、用户名、密钥路径——**不存密码**。
 */
export function saveDeployState(host, data) {
  mkdirSync(STATE_DIR, { recursive: true });
  const file = join(STATE_DIR, `deploy-${host.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows 忽略
  }
  return file;
}

export function loadDeployState(host) {
  const file = join(STATE_DIR, `deploy-${host.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}