<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

interface SiteSettings {
  SITE_NAME: string;
  SITE_SLOGAN: string;
  SITE_POEM: string;
  SITE_URL: string;
}

const form = reactive<SiteSettings>({
  SITE_NAME: '',
  SITE_SLOGAN: '',
  SITE_POEM: '',
  SITE_URL: '',
});

const original = reactive<SiteSettings>({
  SITE_NAME: '',
  SITE_SLOGAN: '',
  SITE_POEM: '',
  SITE_URL: '',
});

const saving = ref(false);
const loading = ref(true);

const pwdState = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });
const pwdSaving = ref(false);

function applyToForm(s: SiteSettings) {
  form.SITE_NAME = s.SITE_NAME;
  form.SITE_SLOGAN = s.SITE_SLOGAN;
  form.SITE_POEM = s.SITE_POEM;
  form.SITE_URL = s.SITE_URL;
  original.SITE_NAME = s.SITE_NAME;
  original.SITE_SLOGAN = s.SITE_SLOGAN;
  original.SITE_POEM = s.SITE_POEM;
  original.SITE_URL = s.SITE_URL;
}

onMounted(async () => {
  try {
    const s = await api.settings() as unknown as SiteSettings;
    applyToForm(s);
    loading.value = false;
  } catch (e) {
    emit('notify', (e as Error).message, true);
    loading.value = false;
  }
});

async function save() {
  saving.value = true;
  try {
    const result = await api.saveSettings({
      SITE_NAME: form.SITE_NAME.trim(),
      SITE_SLOGAN: form.SITE_SLOGAN.trim(),
      SITE_POEM: form.SITE_POEM.trim(),
      SITE_URL: form.SITE_URL.trim(),
    });
    applyToForm(form);
    emit('notify', result.saved ? `已保存：${result.saved.join('、')}` : '无需变更');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    saving.value = false;
  }
}

async function changePassword() {
  if (pwdState.newPassword !== pwdState.confirmPassword) {
    emit('notify', '两次输入的新密码不一致', true);
    return;
  }
  pwdSaving.value = true;
  try {
    const result = await api.changePassword(pwdState.oldPassword, pwdState.newPassword);
    pwdState.oldPassword = '';
    pwdState.newPassword = '';
    pwdState.confirmPassword = '';
    emit('notify', result.message ?? '密码已更新，请重新登录');
    setTimeout(() => window.dispatchEvent(new CustomEvent('auth:expired')), 1500);
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    pwdSaving.value = false;
  }
}
</script>

<template>
  <div class="page-head">
    <span class="kicker">配 置</span>
    <h1>站点设置</h1>
  </div>

  <div class="card pad" v-if="!loading">
    <h3 style="margin:0 0 20px;">站点信息</h3>
    <div class="field">
      <label>站点名称</label>
      <input v-model="form.SITE_NAME" maxlength="200" class="input" />
    </div>
    <div class="field">
      <label>副标题 / 宣传语（Slogan）</label>
      <input v-model="form.SITE_SLOGAN" maxlength="200" class="input" />
    </div>
    <div class="field">
      <label>扉页诗句（Poem）</label>
      <textarea v-model="form.SITE_POEM" maxlength="500" class="textarea" rows="3" />
    </div>
    <div class="field">
      <label>站点 URL（含协议、不含尾斜杠）</label>
      <input v-model="form.SITE_URL" maxlength="500" class="input" placeholder="https://example.com" />
    </div>
    <div style="margin-top:20px;display:flex;gap:12px;align-items:center;">
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
      <span v-if="
        form.SITE_NAME !== original.SITE_NAME ||
        form.SITE_SLOGAN !== original.SITE_SLOGAN ||
        form.SITE_POEM !== original.SITE_POEM ||
        form.SITE_URL !== original.SITE_URL
      " style="color:var(--cinnabar);font-size:0.82rem;">
        有未保存的修改
      </span>
    </div>
  </div>

  <div class="card pad" v-if="!loading" style="margin-top:20px;">
    <h3 style="margin:0 0 20px;">修改管理员密码</h3>
    <div class="field">
      <label>原密码</label>
      <input v-model="pwdState.oldPassword" type="password" class="input" autocomplete="current-password" />
    </div>
    <div class="field">
      <label>新密码（至少 8 位，含字母+数字/特殊字符）</label>
      <input v-model="pwdState.newPassword" type="password" class="input" autocomplete="new-password" />
    </div>
    <div class="field">
      <label>确认新密码</label>
      <input v-model="pwdState.confirmPassword" type="password" class="input" autocomplete="new-password" />
    </div>
    <div style="margin-top:20px;display:flex;gap:12px;align-items:center;">
      <button class="btn btn-primary" :disabled="pwdSaving" @click="changePassword">
        {{ pwdSaving ? '更新中…' : '更新密码' }}
      </button>
      <span style="color:var(--ink-light);font-size:0.82rem;">更新后旧会话将立即失效，需重新登录</span>
    </div>
  </div>

  <div v-if="loading" style="text-align:center;padding:40px 0;color:var(--ink-light);">
    加载中…
  </div>
</template>