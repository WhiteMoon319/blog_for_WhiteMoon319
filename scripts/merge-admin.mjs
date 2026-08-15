import { cpSync, rmSync } from 'node:fs';

rmSync('dist/client/admin', { recursive: true, force: true });
cpSync('admin/dist', 'dist/client/admin', { recursive: true });
console.log('admin bundle merged into dist/client/admin');