<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
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

interface AiSettings {
  ai_provider: string;
  ai_base_url: string;
  ai_model: string;
  ai_reasoning_effort: string;
  ai_multi_summary: string;
  ai_candidate_count: string;
  ai_api_key_configured?: boolean;
  ai_api_key_masked?: string | boolean;
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

const aiForm = reactive({
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  reasoningEffort: '',
  multiSummary: false,
  candidateCount: 3,
  apiKey: '',
});

const aiOriginal = reactive({
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  reasoningEffort: '',
  multiSummary: false,
  candidateCount: 3,
});

const aiKeyConfigured = ref(false);
const aiKeyMasked = ref('');
const modelList = ref<string[]>([]);
const fetchingModels = ref(false);
const testingAi = ref(false);
const aiSaving = ref(false);

interface PromptTemplate { id: string; name: string; prompt: string; }
const promptTemplates = ref<PromptTemplate[]>([]);
const promptSaving = ref(false);

function parseTemplates(raw: string | undefined): PromptTemplate[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.prompt === 'string');
  } catch { /* ignore */ }
  return [];
}

async function savePromptTemplates() {
  promptSaving.value = true;
  try {
    const trimmed = promptTemplates.value
      .filter((t) => t.id.trim() && t.name.trim() && t.prompt.trim())
      .map((t) => ({ id: t.id.trim(), name: t.name.trim(), prompt: t.prompt.trim() }));
    const result = await api.saveSettings({ ai_prompt_templates: JSON.stringify(trimmed) });
    emit('notify', 'Prompt 模板已保存');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    promptSaving.value = false;
  }
}

function addPromptTemplate() {
  promptTemplates.value.push({ id: `prompt-${Date.now()}`, name: '新模板', prompt: '' });
}

function removePromptTemplate(i: number) {
  promptTemplates.value.splice(i, 1);
}

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

const commentAutoApprove = ref('');

// ---- 邮件（SMTP）配置 ----
const emailForm = reactive({
  smtp_host: '',
  smtp_port: 465,
  smtp_username: '',
  smtp_password: '',
  from_email: '',
});
const emailConfigured = ref(false);
const emailTesting = ref(false);
const emailMasked = reactive({ host: '', username: '', from: '' });

function applyEmailSettings(s: Record<string, unknown>) {
  emailConfigured.value = !!(s as { email_configured?: boolean }).email_configured;
  const raw = (s as Record<string, unknown>).email as Record<string, unknown> | undefined;
  if (raw) {
    emailMasked.host = (raw.smtp_host as string) ?? '';
    emailMasked.username = (raw.smtp_username as string) ?? '';
    emailMasked.from = (raw.from_email as string) ?? '';
  }
}

async function loadEmailStatus() {
  try {
    const res = await api.emailSettings();
    emailConfigured.value = res.configured;
    if (res.configured) {
      emailMasked.host = res.smtp_host ?? '';
      emailMasked.username = res.smtp_username ?? '';
      emailMasked.from = res.from_email ?? '';
    }
  } catch { /* ignore */ }
}

async function testAndSaveEmail() {
  if (emailTesting.value) return;
  emailTesting.value = true;
  try {
    const res = await api.emailTestAndSave({
      smtp_host: emailForm.smtp_host.trim(),
      smtp_port: emailForm.smtp_port,
      smtp_username: emailForm.smtp_username.trim(),
      smtp_password: emailForm.smtp_password.trim(),
      from_email: emailForm.from_email.trim(),
    });
    if (res.ok) {
      emailConfigured.value = true;
      emailMasked.host = emailForm.smtp_host.trim();
      emailMasked.username = emailForm.smtp_username.trim();
      emailMasked.from = emailForm.from_email.trim();
      emailForm.smtp_password = '';
      emit('notify', 'SMTP 测试成功，配置已保存');
    } else {
      emit('notify', `SMTP 测试失败：${res.error ?? '未知错误'}`, true);
    }
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    emailTesting.value = false;
  }
}

async function clearEmail() {
  if (!confirm('确认清除 SMTP 邮件配置？清除后注册验证码与通知邮件将无法发送。')) return;
  try {
    await api.emailClear();
    emailConfigured.value = false;
    emailMasked.host = '';
    emailMasked.username = '';
    emailMasked.from = '';
    emit('notify', 'SMTP 配置已清除');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

function applyCommentSettings(s: Record<string, unknown>) {
  commentAutoApprove.value = (s.comment_review_keywords as string) ?? '';
}

async function saveCommentSettings() {
  saving.value = true;
  try {
    const result = await api.saveSettings({ comment_review_keywords: commentAutoApprove.value.trim() });
    emit('notify', result.saved ? `已保存：${result.saved.join('、')}` : '无需变更');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    saving.value = false;
  }
}

function applyAiSettings(s: AiSettings) {
  aiForm.provider = s.ai_provider || 'deepseek';
  aiForm.baseUrl = s.ai_base_url || 'https://api.deepseek.com';
  aiForm.model = s.ai_model || 'deepseek-v4-flash';
  aiForm.reasoningEffort = s.ai_reasoning_effort || '';
  aiForm.multiSummary = s.ai_multi_summary === '1';
  aiForm.candidateCount = Number(s.ai_candidate_count) || 3;
  aiOriginal.provider = aiForm.provider;
  aiOriginal.baseUrl = aiForm.baseUrl;
  aiOriginal.model = aiForm.model;
  aiOriginal.reasoningEffort = aiForm.reasoningEffort;
  aiOriginal.multiSummary = aiForm.multiSummary;
  aiOriginal.candidateCount = aiForm.candidateCount;
  aiKeyConfigured.value = !!s.ai_api_key_configured;
  aiKeyMasked.value = typeof s.ai_api_key_masked === 'string' ? s.ai_api_key_masked : '';
}

onMounted(async () => {
  try {
    const s = await api.settings() as unknown as SiteSettings & AiSettings;
    applyToForm(s);
    applyAiSettings(s);
    promptTemplates.value = parseTemplates((s as unknown as Record<string, string>).ai_prompt_templates);
    applyCommentSettings(s as unknown as Record<string, unknown>);
    await loadEmailStatus();
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

async function fetchModels() {
  fetchingModels.value = true;
  try {
    const res = await api.aiModels();
    modelList.value = res.models;
    if (res.models.length > 0) {
      aiForm.model = res.models[0];
      emit('notify', `已获取 ${res.models.length} 个模型`);
    }
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    fetchingModels.value = false;
  }
}

async function testAndSave() {
  if (testingAi.value || aiSaving.value) return;
  testingAi.value = true;
  try {
    const res = await api.aiTest({
      provider: aiForm.provider,
      base_url: aiForm.baseUrl,
      model: aiForm.model,
      reasoning_effort: aiForm.reasoningEffort,
      api_key: aiForm.apiKey || undefined,
    });
    if (res.ok) {
      aiKeyConfigured.value = !!res.api_key_configured;
      aiKeyMasked.value = typeof res.api_key_masked === 'string' ? res.api_key_masked : '';
      aiForm.apiKey = '';
      applyAiSettings({ ...aiForm, ...res } as unknown as AiSettings);
      emit('notify', '测试成功，配置已保存');
    } else {
      emit('notify', `测试失败：${res.error ?? '未知错误'}`, true);
    }
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    testingAi.value = false;
  }
}

async function deleteAiKey() {
  if (!confirm('确认清除 AI API Key？清除后 AI 摘要功能将不可用，直到配置新 Key。')) return;
  try {
    await api.deleteAiKey();
    aiKeyConfigured.value = false;
    aiKeyMasked.value = '';
    emit('notify', 'API Key 已清除');
  } catch (e) {
    emit('notify', (e as Error).message, true);
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
    <h3 style="margin:0 0 20px;">AI 摘要</h3>

    <div class="field">
      <label>服务商</label>
      <select v-model="aiForm.provider" class="select">
        <option value="deepseek">DeepSeek</option>
        <option value="openai_compatible">OpenAI Compatible</option>
      </select>
    </div>
    <div class="field">
      <label>API 地址</label>
      <input v-model="aiForm.baseUrl" class="input" placeholder="https://api.deepseek.com" />
    </div>
    <div class="field">
      <label>API Key</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input v-model="aiForm.apiKey" type="password" class="input" style="flex:1;" placeholder="留空则不修改" />
        <span v-if="aiKeyConfigured" style="font-size:0.78rem;color:var(--ink-light);">{{ aiKeyMasked }}</span>
        <span v-else style="font-size:0.78rem;color:var(--cinnabar);">未配置</span>
      </div>
      <div class="hint" style="margin-top:4px;">
        填写后随「测试并保存」落库，不会明文返回前端。
        <button class="btn btn-danger mini" @click="deleteAiKey" :disabled="!aiKeyConfigured" style="margin-left:8px;">清除 Key</button>
      </div>
    </div>
    <div class="field">
      <label>模型</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input v-model="aiForm.model" class="input" style="flex:1;" list="model-list" placeholder="deepseek-v4-flash" />
        <datalist id="model-list">
          <option v-for="m in modelList" :key="m" :value="m" />
        </datalist>
        <button class="btn btn-ghost" :disabled="fetchingModels" @click="fetchModels">
          {{ fetchingModels ? '获取中…' : '获取模型列表' }}
        </button>
      </div>
    </div>
    <div class="field">
      <label>思考强度（reasoning_effort）</label>
      <input v-model="aiForm.reasoningEffort" class="input" placeholder="留空不传，如 low / medium / high" />
    </div>
    <div class="field">
      <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;">
        <input v-model="aiForm.multiSummary" type="checkbox" />
        生成多条摘要供选择
      </label>
    </div>
    <div class="field" v-if="aiForm.multiSummary">
      <label>候选条数（2～5）</label>
      <input v-model.number="aiForm.candidateCount" type="number" min="2" max="5" class="input" style="width:100px;" />
    </div>
    <div class="hint" style="margin:12px 0;">
      文章内容会发送到您配置的第三方 AI 服务商。请确认服务商的数据保留、训练使用和合规策略。
    </div>
    <div style="margin-top:16px;display:flex;gap:12px;align-items:center;">
      <button class="btn btn-primary" :disabled="testingAi" @click="testAndSave">
        {{ testingAi ? '测试中…' : '测试并保存' }}
      </button>
      <span style="font-size:0.82rem;color:var(--ink-light);">
        测试连接成功后自动保存配置和 API Key
      </span>
    </div>
  </div>

  <div class="card pad" v-if="!loading" style="margin-top:20px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <h3 style="margin:0;">Prompt 模板</h3>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost mini" @click="addPromptTemplate">＋ 新增模板</button>
        <button class="btn btn-primary mini" :disabled="promptSaving" @click="savePromptTemplates">
          {{ promptSaving ? '保存中…' : '保存模板' }}
        </button>
      </div>
    </div>
    <div class="field" style="margin-top:10px;">
      <label>模板说明</label>
      <div class="hint">
        每套模板定义一组 AI 提示词。文集可指定使用哪套；编辑器生成时默认跟随文集，也可临时切换。
        <code>overview</code> 为默认博客摘要，<code>teaser</code> 为章节导读（适合小说/连载，不剧透）。
      </div>
    </div>
    <div v-for="(t, i) in promptTemplates" :key="i" class="prompt-card" style="border:1px solid var(--hairline);border-radius:8px;padding:14px;margin-top:12px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input v-model="t.id" class="input" style="width:130px;font-family:var(--font-mono);" placeholder="标识(如 overview)" />
        <input v-model="t.name" class="input" style="width:160px;" placeholder="名称" />
        <button class="btn btn-danger mini" :disabled="promptSaving" @click="removePromptTemplate(i)">删</button>
      </div>
      <textarea v-model="t.prompt" class="textarea" style="margin-top:8px;" rows="6" placeholder="提示词内容…" />
    </div>
    <div class="hint" style="margin-top:8px;">
      注意：<code>id</code> 是内部标识，改动后文集与历史生成的引用不再对应，建议保持稳定。
    </div>
  </div>

  <div class="card pad" v-if="!loading" style="margin-top:20px;">
    <h3 style="margin:0 0 20px;">邮件（SMTP）</h3>
    <div class="field">
      <label>SMTP 服务器</label>
      <input v-model="emailForm.smtp_host" class="input" placeholder="smtp.qq.com" />
    </div>
    <div class="field">
      <label>端口</label>
      <input v-model.number="emailForm.smtp_port" type="number" class="input" style="width:100px;" />
    </div>
    <div class="field">
      <label>用户名</label>
      <input v-model="emailForm.smtp_username" class="input" placeholder="邮箱地址或授权码用户名" />
    </div>
    <div class="field">
      <label>授权码 / 密码</label>
      <input v-model="emailForm.smtp_password" type="password" class="input" placeholder="留空则不修改" />
      <div class="hint" style="margin-top:4px;">
        <span v-if="emailConfigured" style="color:var(--ink-light);">已配置：{{ emailMasked.host }} → {{ emailMasked.username }}</span>
        <span v-else style="color:var(--cinnabar);">未配置</span>
        <button class="btn btn-danger mini" :disabled="!emailConfigured" @click="clearEmail" style="margin-left:8px;">清除配置</button>
      </div>
    </div>
    <div class="field">
      <label>发件邮箱</label>
      <input v-model="emailForm.from_email" class="input" placeholder="noreply@example.com" />
    </div>
    <div class="hint" style="margin:8px 0;">
      用于发送注册验证码、回复通知等邮件。测试成功后自动保存配置（授权码加密存储）。
    </div>
    <div style="margin-top:12px;display:flex;gap:12px;align-items:center;">
      <button class="btn btn-primary" :disabled="emailTesting" @click="testAndSaveEmail">
        {{ emailTesting ? '测试中…' : '测试并保存' }}
      </button>
    </div>
  </div>

  <div class="card pad" v-if="!loading" style="margin-top:20px;">
    <h3 style="margin:0 0 20px;">评论设置</h3>
    <div class="field">
      <label>需人工审核的关键词</label>
      <input v-model="commentAutoApprove" class="input" placeholder="如：广告，联系方式（逗号分隔；留空则全部直接展示）" />
      <div class="hint">命中任一关键词的评论将保持待审核状态；未命中关键词的评论默认直接展示。</div>
    </div>
    <div style="margin-top:16px;display:flex;gap:12px;align-items:center;">
      <button class="btn btn-primary" :disabled="saving" @click="saveCommentSettings">
        {{ saving ? '保存中…' : '保存评论设置' }}
      </button>
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