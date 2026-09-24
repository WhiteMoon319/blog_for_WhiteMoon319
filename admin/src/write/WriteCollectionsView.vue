<!-- 月下独酌 · blog（blog_for_WhiteMoon319） -->
<!-- Copyright (C) 2026 WhiteMoon319 · AGPL-3.0-or-later · 源码见 https://github.com/WhiteMoon319/blog_for_WhiteMoon319 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import type { AuthorOption, CollectionWriteView } from '../types';

const emit = defineEmits<{ notify: [msg: string, err?: boolean] }>();

const mine = ref<CollectionWriteView[]>([]);
const all = ref<CollectionWriteView[]>([]);
const authors = ref<AuthorOption[]>([]);
const loaded = ref(false);
const busy = ref(false);

// 新建表单
const creating = ref(false);
const draft = ref({ title: '', slug: '', summary: '', is_public: false });

// 展开的协作面板：文集 id → 成员/申请
const openId = ref<number | null>(null);
const members = ref<Array<{ user_id: number; username: string; display_name: string }>>([]);
const invites = ref<Array<{ id: number; user_id: number; username: string; display_name: string; message: string }>>([]);
const pickUser = ref<number | ''>('');

/** 别人的私有文集：我能看到，但需要申请才能写入 */
const needInvite = computed(() => all.value.filter((c) => !c.can_write && c.relation === 'private'));

async function load() {
  busy.value = true;
  try {
    const [m, v] = await Promise.all([api.myCollections(), api.collectionView()]);
    mine.value = m.collections;
    all.value = v.collections;
    loaded.value = true;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function create() {
  if (!draft.value.title.trim()) return emit('notify', '文集名不可为空', true);
  try {
    await api.createCollection({
      title: draft.value.title.trim(),
      slug: draft.value.slug.trim() || undefined,
      summary: draft.value.summary,
      is_public: draft.value.is_public ? 1 : 0,
    });
    emit('notify', draft.value.is_public ? '文集已建（公用：任何作者可投稿）' : '文集已建（私有：需你同意才能投稿）');
    draft.value = { title: '', slug: '', summary: '', is_public: false };
    creating.value = false;
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

/** 改公用状态只影响后续投稿，已收录的文章不受影响 */
async function togglePublic(c: CollectionWriteView) {
  const next = c.is_public === 1 ? false : true;
  const warn = next
    ? '改为公用后，任何作者都可往这个文集投稿。'
    : '改为私有后，其他人不能再投稿（已被拉入的协作者除外），已收录的文章保留。';
  if (!confirm(`${warn}\n\n确认修改「${c.title}」？`)) return;
  try {
    await api.updateCollection(c.id, { is_public: next ? 1 : 0 });
    emit('notify', next ? '已设为公用' : '已设为私有');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function rename(c: CollectionWriteView) {
  const title = prompt('文集名：', c.title);
  if (title === null) return;
  if (!title.trim()) return emit('notify', '文集名不可为空', true);
  const summary = prompt('文集简介（留空即清除）：', c.summary ?? '');
  if (summary === null) return;
  try {
    await api.updateCollection(c.id, { title: title.trim(), summary: summary.trim() });
    emit('notify', '已更新');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function remove(c: CollectionWriteView) {
  if (!confirm(`确要删除文集「${c.title}」？其中的文章会移到未分类（不会被删除）。\n\n若集内有他人文章，删除会被拒绝。`)) return;
  try {
    await api.deleteCollection(c.id);
    emit('notify', '文集已删除');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function openPanel(c: CollectionWriteView) {
  if (openId.value === c.id) {
    openId.value = null;
    return;
  }
  try {
    const [m, a] = await Promise.all([api.collectionMembers(c.id), api.authors()]);
    members.value = m.members;
    invites.value = m.invites;
    authors.value = a.authors;
    pickUser.value = '';
    openId.value = c.id;
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

const addable = computed(() => {
  const taken = new Set(members.value.map((m) => m.user_id));
  return authors.value.filter((a) => !taken.has(a.id));
});

async function addMember() {
  if (openId.value === null || pickUser.value === '') return;
  const target = openId.value;
  try {
    await api.collectionAddMember(target, Number(pickUser.value));
    emit('notify', '已拉入协作者');
    pickUser.value = '';
    await refreshPanel(target);
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function refreshPanel(id: number) {
  const m = await api.collectionMembers(id);
  members.value = m.members;
  invites.value = m.invites;
}

async function removeMember(userId: number) {
  if (openId.value === null) return;
  if (!confirm('移除该协作者？其已写入的文章会保留在集内，只影响后续投稿。')) return;
  try {
    await api.collectionRemoveMember(openId.value, userId);
    emit('notify', '已移除协作者');
    await refreshPanel(openId.value);
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function decide(inviteId: number, agree: boolean) {
  if (openId.value === null) return;
  try {
    await api.collectionDecideInvite(openId.value, inviteId, agree);
    emit('notify', agree ? '已同意，对方可投稿了' : '已拒绝');
    await refreshPanel(openId.value);
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

async function join(c: CollectionWriteView) {
  const message = prompt(`申请加入「${c.title}」（可留空）：`, '');
  if (message === null) return;
  try {
    await api.collectionJoin(c.id, message.trim());
    emit('notify', '申请已发送，等待文集作者同意');
    await load();
  } catch (e) {
    emit('notify', (e as Error).message, true);
  }
}

function inviteLabel(c: CollectionWriteView): string {
  if (c.invite_status === 'pending') return '已申请，待同意';
  if (c.invite_status === 'rejected') return '曾被拒绝，可再申请';
  return '申请协作';
}

onMounted(load);
</script>

<template>
  <div class="page-head">
    <span class="kicker">文 集</span>
    <h1>我的文集</h1>
    <p class="hint" style="margin-top:6px;">
      公用文集任何作者都能投稿；私有文集只有你与拉入的协作者能投稿。别人想投稿需你同意。
    </p>
  </div>

  <div class="card">
    <div class="card-head">
      <span style="color:var(--ink-light);font-size:0.85rem;">共 {{ mine.length }} 个自建文集</span>
      <button class="btn btn-primary" @click="creating = !creating">
        {{ creating ? '收起' : '新建文集' }}
      </button>
    </div>

    <div v-if="creating" class="create-box">
      <div class="form-row">
        <div class="field">
          <label>文集名</label>
          <input v-model="draft.title" class="input" placeholder="如：游记" />
        </div>
        <div class="field">
          <label>slug（可选，留空自动生成）</label>
          <input v-model="draft.slug" class="input" placeholder="travel" />
        </div>
      </div>
      <div class="field">
        <label>简介</label>
        <input v-model="draft.summary" class="input" placeholder="一句话说明这个文集" />
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" v-model="draft.is_public" />
          <span>公用（任何作者都可投稿；不勾选则私有，需你同意）</span>
        </label>
      </div>
      <button class="btn btn-primary" :disabled="busy" @click="create">创建</button>
    </div>

    <div class="table-wrap">
      <table class="table" v-if="mine.length">
        <thead>
          <tr>
            <th>文集</th>
            <th>投稿</th>
            <th>简介</th>
            <th style="text-align:right;">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="c in mine" :key="c.id">
            <tr>
              <td>
                <span class="color-dot" :style="{ background: c.theme_color || '#8a6d3b' }"></span>
                {{ c.title }}
                <span style="color:var(--ink-light);font-size:0.78rem;">/{{ c.slug }}</span>
              </td>
              <td>
                <button
                  class="tag"
                  :class="c.is_public === 1 ? 'tag-published' : 'tag-draft'"
                  style="border:none;cursor:pointer;"
                  @click="togglePublic(c)"
                >
                  {{ c.is_public === 1 ? '公用' : '私有' }}
                </button>
              </td>
              <td style="color:var(--ink-light);font-size:0.82rem;">{{ c.summary || '—' }}</td>
              <td>
                <div class="actions">
                  <button class="btn btn-ghost mini" @click="openPanel(c)">协作</button>
                  <button class="btn btn-ghost mini" @click="rename(c)">改名</button>
                  <button class="btn btn-danger mini" @click="remove(c)">删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="openId === c.id">
              <td colspan="4" class="panel">
                <div v-if="invites.length" class="panel-block">
                  <strong>待处理申请</strong>
                  <div v-for="i in invites" :key="i.id" class="panel-row">
                    <span>{{ i.display_name || i.username }} 申请投稿<template v-if="i.message">：{{ i.message }}</template></span>
                    <span>
                      <button class="btn btn-primary mini" @click="decide(i.id, true)">同意</button>
                      <button class="btn btn-ghost mini" @click="decide(i.id, false)">拒绝</button>
                    </span>
                  </div>
                </div>
                <div class="panel-block">
                  <strong>协作者</strong>
                  <div v-if="!members.length" class="hint">还没有协作者。</div>
                  <div v-for="m in members" :key="m.user_id" class="panel-row">
                    <span>{{ m.display_name || m.username }}</span>
                    <button class="btn btn-ghost mini" @click="removeMember(m.user_id)">移除</button>
                  </div>
                </div>
                <div class="panel-block">
                  <strong>拉入协作者</strong>
                  <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                    <select v-model="pickUser" class="select" style="width:auto;">
                      <option value="">选择作者…</option>
                      <option v-for="a in addable" :key="a.id" :value="a.id">
                        {{ a.display_name?.trim() || a.username }}
                      </option>
                    </select>
                    <button class="btn btn-ghost mini" :disabled="pickUser === ''" @click="addMember">拉入</button>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-else-if="loaded" class="empty">还没有自建文集。</div>
    </div>
  </div>

  <div class="card" v-if="needInvite.length">
    <div class="card-head">
      <span style="color:var(--ink-light);font-size:0.85rem;">他人的私有文集（需对方同意才能投稿）</span>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>文集</th>
            <th>状态</th>
            <th style="text-align:right;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in needInvite" :key="c.id">
            <td>{{ c.title }}</td>
            <td style="color:var(--ink-light);font-size:0.82rem;">{{ c.invite_status === 'pending' ? '申请待处理' : c.invite_status === 'rejected' ? '已被拒绝' : '—' }}</td>
            <td>
              <button class="btn btn-ghost mini" :disabled="c.invite_status === 'pending'" @click="join(c)">
                {{ inviteLabel(c) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.create-box {
  border: 1px dashed var(--line, #ddd);
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.panel {
  background: var(--paper-soft, #faf7f1);
  padding: 12px 14px;
}
.panel-block + .panel-block {
  margin-top: 12px;
}
.panel-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 0.85rem;
}
</style>
