import { cpSync, rmSync } from 'node:fs';

rmSync('dist/admin', { recursive: true, force: true });
cpSync('admin/dist', 'dist/admin', { recursive: true });
console.log('admin bundle merged into dist/admin');