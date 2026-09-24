// 月下独酌 · blog（blog_for_WhiteMoon319）
// Copyright (C) 2026 WhiteMoon319
//
// 本程序是自由软件：你可以自由修改和再分发它。
// 请遵守 AGPL-3.0 或更高版本许可协议（GNU Affero General Public License v3+）：
//   https://github.com/WhiteMoon319/blog_for_WhiteMoon319
// SPDX-License-Identifier: AGPL-3.0-or-later

import { reactive } from 'vue';
import { api } from '../api';

export const authState = reactive({
  authed: false,
  checking: true,
  role: '' as string,
  /** 当前用户 id（来自会话 sub=user:{id}）：编辑器署名默认值等本地判断用 */
  userId: 0,
});

export async function initAuth(): Promise<void> {
  try {
    const me = await api.me();
    authState.authed = me.authenticated;
    authState.role = (me as unknown as { role?: string }).role ?? '';
    const m = String((me as unknown as { sub?: string }).sub ?? '').match(/^user:(\d+)$/);
    authState.userId = m ? Number(m[1]) : 0;
  } catch {
    authState.authed = false;
    authState.role = '';
    authState.userId = 0;
  }
  authState.checking = false;
}

export function setAuthed(value: boolean, role = '', userId = 0): void {
  authState.authed = value;
  authState.role = role;
  authState.userId = userId;
}