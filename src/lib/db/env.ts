type EnvResolver = () => Promise<Env>;
let resolveEnv: EnvResolver = async () => (await import('cloudflare:workers')).env;

export function __setEnvResolver(fn: EnvResolver): void {
  resolveEnv = fn;
}

export async function envOf(): Promise<Env> {
  return resolveEnv();
}