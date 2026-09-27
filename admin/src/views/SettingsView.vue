<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import PageHead from '../components/PageHead.vue';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

interface SiteSettings {
  SITE_NAME: string;
  SITE_SLOGAN: string;
  SITE_POEM: string;
  SITE_URL: string;
  site_tagline: string;
  footer_line: string;
  search_placeholder: string;
  hero_note: string;
  site_locale: string;
}

const COPY_KEYS = ['site_tagline', 'footer_line', 'search_placeholder', 'hero_note', 'site_locale'] as const;

function emptySiteSettings(): SiteSettings {
  return {
    SITE_NAME: '',
    SITE_SLOGAN: '',
    SITE_POEM: '',
    SITE_URL: '',
    site_tagline: '',
    footer_line: '',
    search_placeholder: '',
    hero_note: '',
    site_locale: 'zh-CN',
  };
}

const form = reactive<SiteSettings>(emptySiteSettings());

const original = reactive<SiteSettings>(emptySiteSettings());

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

interface PromptTemplate { id: string; name: string; prompt: string; }
const promptTemplates = ref<PromptTemplate[]>([]);

function parseTemplates(raw: string | undefined): PromptTemplate[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.prompt === 'string');
  } catch { /* ignore */ }
  return [];
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
  for (const k of [...('SITE_NAME SITE_SLOGAN SITE_POEM SITE_URL'.split(' ')), ...COPY_KEYS] as (keyof SiteSettings)[]) {
    form[k] = s[k];
    original[k] = s[k];
  }
}

const commentAutoApprove = ref('');
/** 已落库的评论关键词与模板快照，用来判定「未保存」 */
const commentOriginal = ref('');
const templatesOriginal = ref('[]');

// ---- 分区导航（左栏锚点 + 滚动高亮）----
const SECTIONS = [
  { id: 'site', label: '站点' },
  { id: 'ai', label: 'AI 摘要' },
  { id: 'prompts', label: 'Prompt 模板' },
  { id: 'email', label: '邮件' },
  { id: 'comments', label: '评论' },
  { id: 'security', label: '安全' },
] as const;
const activeSection = ref<string>('site');
let sectionObserver: IntersectionObserver | null = null;
let sectionTimer: number | undefined;

function observeSections(): void {
  sectionObserver?.disconnect();
  sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) activeSection.value = visible[0].target.id;
    },
    { rootMargin: '-120px 0px -55% 0px' },
  );
  for (const s of SECTIONS) {
    const el = document.getElementById(s.id);
    if (el) sectionObserver.observe(el);
  }
}
function jumpTo(id: string): void {
  activeSection.value = id;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- 未保存判定：整页一个保存，但各区各算自己的「脏」 ----
const siteDirty = computed(() =>
  ([...('SITE_NAME SITE_SLOGAN SITE_POEM SITE_URL'.split(' ')), ...COPY_KEYS] as (keyof SiteSettings)[]).some(
    (k) => form[k] !== original[k],
  ),
);
const commentDirty = computed(() => commentAutoApprove.value.trim() !== commentOriginal.value);
const templatesTrimmed = computed(() =>
  JSON.stringify(
    promptTemplates.value
      .filter((t) => t.id.trim() && t.name.trim() && t.prompt.trim())
      .map((t) => ({ id: t.id.trim(), name: t.name.trim(), prompt: t.prompt.trim() })),
  ),
);
const templatesDirty = computed(() => templatesTrimmed.value !== templatesOriginal.value);
const aiDirty = computed(
  () =>
    aiForm.apiKey !== '' ||
    aiForm.provider !== aiOriginal.provider ||
    aiForm.baseUrl !== aiOriginal.baseUrl ||
    aiForm.model !== aiOriginal.model ||
    aiForm.reasoningEffort !== aiOriginal.reasoningEffort ||
    aiForm.multiSummary !== aiOriginal.multiSummary ||
    aiForm.candidateCount !== aiOriginal.candidateCount,
);
const emailDirty = computed(() => {
  const base = emailConfigured.value ? emailMasked : { host: '', username: '', from: '' };
  return (
    emailForm.smtp_host.trim() !== base.host ||
    emailForm.smtp_username.trim() !== base.username ||
    emailForm.from_email.trim() !== base.from ||
    emailForm.smtp_password !== ''
  );
});
const dirtyCount = computed(
  () => [siteDirty.value, commentDirty.value, templatesDirty.value, aiDirty.value, emailDirty.value].filter(Boolean).length,
);


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

async function loadEmailStatus() {
  try {
    const res = await api.emailSettings();
    emailConfigured.value = res.configured;
    if (res.configured) {
      emailMasked.host = res.smtp_host ?? '';
      emailMasked.username = res.smtp_username ?? '';
      emailMasked.from = res.from_email ?? '';
      // 回填已配置值：否则「未保存」判定会把空表单当成改动
      emailForm.smtp_host = emailMasked.host;
      emailForm.smtp_username = emailMasked.username;
      emailForm.from_email = emailMasked.from;
    }
  } catch { /* ignore */ }
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
    templatesOriginal.value = templatesTrimmed.value;
    applyCommentSettings(s as unknown as Record<string, unknown>);
    commentOriginal.value = commentAutoApprove.value.trim();
    await loadEmailStatus();
    loading.value = false;
    await nextTick();
    observeSections();
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
      site_tagline: form.site_tagline.trim(),
      footer_line: form.footer_line.trim(),
      search_placeholder: form.search_placeholder.trim(),
      hero_note: form.hero_note.trim(),
      site_locale: form.site_locale,
    });
    applyToForm(form);
    emit('notify', result.saved ? `已保存：${result.saved.join('、')}` : '无需变更');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    saving.value = false;
  }
}

async function changePassword() {  if (pwdState.newPassword !== pwdState.confirmPassword) {
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

/**
 * 整页保存：只跑「脏」的分区，按接口能力分别落库——
 * 站点/评论/模板是纯设置，一次 saveSettings；AI 与邮件必须测试通过才算保存。
 */
async function saveAll(): Promise<void> {
  if (saving.value || !dirtyCount.value) return;
  saving.value = true;
  const done: string[] = [];
  try {
    if (siteDirty.value || commentDirty.value || templatesDirty.value) {
      const result = await api.saveSettings({
        SITE_NAME: form.SITE_NAME.trim(),
        SITE_SLOGAN: form.SITE_SLOGAN.trim(),
        SITE_POEM: form.SITE_POEM.trim(),
        SITE_URL: form.SITE_URL.trim(),
        site_tagline: form.site_tagline.trim(),
        footer_line: form.footer_line.trim(),
        search_placeholder: form.search_placeholder.trim(),
        hero_note: form.hero_note.trim(),
        site_locale: form.site_locale,
        comment_review_keywords: commentAutoApprove.value.trim(),
        ai_prompt_templates: templatesTrimmed.value,
      });
      applyToForm(form);
      commentOriginal.value = commentAutoApprove.value.trim();
      templatesOriginal.value = templatesTrimmed.value;
      done.push('站点与内容设置');
      void result;
    }
    if (aiDirty.value) {
      await runAiTestAndSave();
      done.push('AI 摘要');
    }
    if (emailDirty.value) {
      await runEmailTestAndSave();
      done.push('邮件');
    }
    emit('notify', done.length ? `已保存：${done.join('、')}` : '无需变更');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    saving.value = false;
  }
}

async function runAiTestAndSave(): Promise<void> {
  if (testingAi.value) return;
  testingAi.value = true;
  try {
    const res = await api.aiTest({
      provider: aiForm.provider,
      base_url: aiForm.baseUrl,
      model: aiForm.model,
      reasoning_effort: aiForm.reasoningEffort,
      api_key: aiForm.apiKey || undefined,
    });
    if (!res.ok) throw new Error(`AI 测试失败：${res.error ?? '未知错误'}`);
    aiKeyConfigured.value = !!res.api_key_configured;
    aiKeyMasked.value = typeof res.api_key_masked === 'string' ? res.api_key_masked : '';
    aiForm.apiKey = '';
    applyAiSettings({ ...aiForm, ...res } as unknown as AiSettings);
  } finally {
    testingAi.value = false;
  }
}

async function runEmailTestAndSave(): Promise<void> {
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
    if (!res.ok) throw new Error(`SMTP 测试失败：${res.error ?? '未知错误'}`);
    emailConfigured.value = true;
    emailMasked.host = emailForm.smtp_host.trim();
    emailMasked.username = emailForm.smtp_username.trim();
    emailMasked.from = emailForm.from_email.trim();
    emailForm.smtp_password = '';
  } finally {
    emailTesting.value = false;
  }
}

/** 仅测试连接（成功即已保存，与整页保存同一条路径） */
async function testAiOnly(): Promise<void> {
  try {
    await runAiTestAndSave();
    emit('notify', '测试成功，配置已保存');
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

/** 仅测试邮件（成功即已保存） */
async function testEmailOnly(): Promise<void> {
  try {
    await runEmailTestAndSave();
    emit('notify', 'SMTP 测试成功，配置已保存');
  } catch (e) {
    emit('notify', (e as Error).message, true);
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
  <PageHead kicker="配 置" title="站点设置">
    <template #actions>
      <span v-if="dirtyCount" class="dirty-hint">{{ dirtyCount }} 项未保存</span>
      <button class="btn btn-primary" :disabled="saving || !dirtyCount" @click="saveAll">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </PageHead>

  <div class="settings-layout" v-if="!loading">
    <nav class="settings-nav" aria-label="设置分区">
      <button
        v-for="s in SECTIONS"
        :key="s.id"
        type="button"
        :class="{ active: activeSection === s.id }"
        @click="jumpTo(s.id)"
      >
        {{ s.label }}
      </button>
    </nav>
    <div class="settings-body">

  <div id="site" class="card pad settings-section">
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
    <div class="field">
      <label>界面语言</label>
      <select v-model="form.site_locale" class="select">
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
      <div class="hint">影响主题界面词汇（后台文案不随此项变化）</div>
    </div>
    <div class="field">
      <label>默认描述</label>
      <input v-model="form.site_tagline" maxlength="200" class="input" placeholder="一座写在 Cloudflare 上的小书斋。" />
      <div class="hint">用于搜索引擎摘要与主题副标题</div>
    </div>
    <div class="field">
      <label>页脚文案行</label>
      <input v-model="form.footer_line" maxlength="200" class="input" />
      <div class="hint">留空则回退为扉页诗句</div>
    </div>
    <div class="field">
      <label>搜索框占位文案（search_placeholder）</label>
      <input v-model="form.search_placeholder" maxlength="100" class="input" />
    </div>
    <div class="field">
      <label>首页题记位（留空不显示）</label>
      <input v-model="form.hero_note" maxlength="200" class="input" />
      <div class="hint">显示在首页首屏的一句短文案</div>
    </div>
    <p v-if="siteDirty" class="section-dirty">本区有未保存的修改</p>
  </div>

  <div id="ai" class="card pad settings-section" v-if="!loading">
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
      <label>思考强度</label>
      <input v-model="aiForm.reasoningEffort" class="input" placeholder="留空不传，如 low / medium / high" />
      <div class="hint">部分服务商支持；留空则用服务商默认</div>
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
    <div style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-ghost" :disabled="testingAi" @click="testAiOnly">
        {{ testingAi ? '测试中…' : '测试连接' }}
      </button>
      <span class="section-note">
        未配置 Key 时无法保存：页头「保存」会先测试连接，通过后才落库
      </span>
      <span v-if="aiDirty" class="section-dirty">本区有未保存的修改</span>
    </div>
  </div>

  <div id="prompts" class="card pad settings-section" v-if="!loading">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <h3 style="margin:0;">Prompt 模板</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-ghost mini" @click="addPromptTemplate">＋ 新增模板</button>
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
        <button class="btn btn-danger mini" @click="removePromptTemplate(i)">删</button>
      </div>
      <textarea v-model="t.prompt" class="textarea" style="margin-top:8px;" rows="6" placeholder="提示词内容…" />
    </div>
    <div class="hint" style="margin-top:8px;">
      注意：<code>id</code> 是内部标识，改动后文集与历史生成的引用不再对应，建议保持稳定。
    </div>
  </div>

  <div id="email" class="card pad settings-section" v-if="!loading">
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
      <input v-model="emailForm.smtp_password" type="password" class="input" placeholder="QQ 邮箱授权码（非 QQ 密码）" />
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
    <div style="margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-ghost" :disabled="emailTesting" @click="testEmailOnly">
        {{ emailTesting ? '测试中…' : '测试连接' }}
      </button>
      <span class="section-note">页头「保存」会在落库前先测试 SMTP；测试失败则不会保存</span>
      <span v-if="emailDirty" class="section-dirty">本区有未保存的修改</span>
    </div>
  </div>

  <div id="comments" class="card pad settings-section" v-if="!loading">
    <h3 style="margin:0 0 20px;">评论设置</h3>
    <div class="field">
      <label>需人工审核的关键词</label>
      <input v-model="commentAutoApprove" class="input" placeholder="如：广告，联系方式（逗号分隔；留空则全部直接展示）" />
      <div class="hint">命中任一关键词的评论将保持待审核状态；未命中关键词的评论默认直接展示。</div>
    </div>
    <p v-if="commentDirty" class="section-dirty">本区有未保存的修改</p>
  </div>

  <div id="security" class="card pad settings-section" v-if="!loading">
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
    <div style="margin-top:20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-primary" :disabled="pwdSaving" @click="changePassword">
        {{ pwdSaving ? '更新中…' : '更新密码' }}
      </button>
      <span class="section-note">密码属于安全操作：单独提交，更新后旧会话立即失效、需重新登录</span>
    </div>
  </div>

    </div>
  </div>

  <div v-if="loading" class="settings-loading">
    加载中…
  </div>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.settings-nav {
  position: sticky;
  top: 84px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-nav button {
  padding: 8px 12px;
  font: inherit;
  font-size: 0.86rem;
  text-align: left;
  white-space: nowrap;
  color: var(--ink-mid);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.settings-nav button:hover {
  color: var(--cinnabar);
  background: rgba(194, 58, 48, 0.06);
}
.settings-nav button.active {
  color: var(--cinnabar);
  border-color: var(--cinnabar-line);
  background: rgba(194, 58, 48, 0.08);
}
.settings-body {
  min-width: 0;
}
/* 锚点跳转时给吸附的顶栏留出空间 */
.settings-section {
  scroll-margin-top: 84px;
}
.settings-section + .settings-section {
  margin-top: 20px;
}
.section-dirty {
  margin: 16px 0 0;
  font-size: 0.82rem;
  color: var(--cinnabar);
}
.section-note {
  font-size: 0.82rem;
  color: var(--ink-light);
}
.dirty-hint {
  font-size: 0.82rem;
  color: var(--cinnabar);
  white-space: nowrap;
}
.settings-loading {
  text-align: center;
  padding: 40px 0;
  color: var(--ink-light);
}
@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
  .settings-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
  }
}
</style>