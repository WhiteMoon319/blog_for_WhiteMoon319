import { reactive } from 'vue';
import { api } from '../api';

export const authState = reactive({
  authed: false,
  checking: true,
});

export async function initAuth(): Promise<void> {
  try {
    const me = await api.me();
    authState.authed = me.authenticated;
  } catch {
    authState.authed = false;
  }
  authState.checking = false;
}

export function setAuthed(value: boolean): void {
  authState.authed = value;
}