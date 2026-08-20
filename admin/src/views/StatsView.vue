<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';

interface DailyPoint { day: string; views: number }
interface TopPost { id: number; title: string; slug: string; views: number }
interface CollectionLite { id: number; title: string }
interface TrendStats {
  days: number;
  start_day: string;
  end_day: string;
  total_views: number;
  daily: DailyPoint[];
  top_posts: TopPost[];
  corpus: { total_chars: number; published_chars: number; post_count: number; collection_id?: number | null };
}

const DAY_OPTIONS = [7, 30, 90, 365];

const stats = ref<TrendStats | null>(null);
const loaded = ref(false);
const corpusLoading = ref(false);
const days = ref(30);
const collections = ref<CollectionLite[]>([]);
const scope = ref<number | 'none' | undefined>(undefined);

const maxViews = computed(() => Math.max(1, ...(stats.value?.daily.map((d) => d.views) ?? [0])));
const avgPerDay = computed(() =>
  stats.value ? Math.round((stats.value.total_views / stats.value.days) * 10) / 10 : 0,
);
const scopeName = computed(() => {
  if (scope.value === 'none') return '未分类文章';
  const c = collections.value.find((x) => x.id === scope.value);
  return c ? `文集「${c.title}」` : '全站';
});
const corpusText = computed(() => {
  const c = stats.value?.corpus;
  if (!c) return { num: '—', label: `${scopeName.value}总字数` };
  const n = c.total_chars;
  const text =
    n >= 10000
      ? `${(n / 10000).toFixed(1)} 万`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)} 千`
        : String(n);
  return {
    num: text,
    label: `${scopeName.value} · ${c.post_count} 篇（已刊 ${c.published_chars.toLocaleString()} 字）`,
  };
});

async function loadTrends() {
  loaded.value = false;
  try {
    const [s, cols] = await Promise.all([api.stats(days.value), api.collections()]);
    stats.value = s;
    collections.value = cols.collections.map((c) => ({ id: c.id, title: c.title }));
  } catch {
    stats.value = null;
  } finally {
    loaded.value = true;
  }
}

async function loadCorpus() {
  corpusLoading.value = true;
  try {
    const corpus = await api.statsCorpus(scope.value);
    if (stats.value) stats.value = { ...stats.value, corpus };
  } catch {
    // 保持旧值，避免打断观感
  } finally {
    corpusLoading.value = false;
  }
}

async function load() {
  await Promise.all([loadTrends(), loadCorpus()]);
}
onMounted(load);
</script>

<template>
  <div class="page-head">
    <span class="kicker">数 据</span>
    <h1>阅读趋势</h1>
    <div class="seg" style="margin-left:auto;">
      <button
        v-for="d in DAY_OPTIONS"
        :key="d"
        class="btn btn-ghost mini"
        :class="{ active: days === d }"
        @click="days = d; loadTrends()"
      >
        {{ d }} 日
      </button>
    </div>
  </div>

  <div v-if="!loaded" style="text-align:center;padding:40px 0;color:var(--ink-light);">加载中…</div>

  <template v-else-if="stats">
    <div class="stat-grid">
      <div class="card stat-card" style="--pc: var(--cinnabar);">
        <div class="num">{{ stats.total_views }}</div>
        <div class="label">区间总阅读</div>
      </div>
      <div class="card stat-card" style="--pc: var(--pine);">
        <div class="num">{{ avgPerDay }}</div>
        <div class="label">日均阅读</div>
      </div>
      <div class="card stat-card" style="--pc: var(--amber);">
        <div class="num">{{ stats.daily.filter((d) => d.views > 0).length }}</div>
        <div class="label">有阅读天数</div>
      </div>
    </div>

    <div class="card pad" style="margin-top:20px;">
      <div class="card-head">
        <h2>字数统计</h2>
        <select v-model="scope" class="select" style="margin-left:auto;max-width:260px;" @change="loadCorpus()">
          <option :value="undefined">全站</option>
          <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.title }}</option>
          <option value="none">未分类</option>
        </select>
      </div>
      <div class="corpus-row">
        <div class="corpus-item">
          <span class="corpus-num">{{ corpusText.num }}</span>
          <span class="muted">{{ scopeName }}正文总字数（含草稿）</span>
        </div>
        <div class="corpus-item">
          <span class="corpus-num">{{ stats.corpus.post_count }}</span>
          <span class="muted">{{ scopeName }}文章数</span>
        </div>
        <div class="corpus-item">
          <span class="corpus-num">{{ stats.corpus.published_chars.toLocaleString() }}</span>
          <span class="muted">{{ scopeName }}已刊字数</span>
        </div>
      </div>
    </div>

    <div class="card pad" style="margin-top:20px;">
      <div class="card-head">
        <h2>每日阅读</h2>
        <span class="muted">{{ stats.start_day }} → {{ stats.end_day }}</span>
      </div>
      <div v-if="stats.total_views === 0" class="muted" style="padding:24px 0;">
        暂无阅读数据。读者访问文章页后，趋势将在这里呈现。
      </div>
      <div v-else class="bar-chart">
        <div
          v-for="p in stats.daily"
          :key="p.day"
          class="bar-col"
          :title="`${p.day}：${p.views} 次`"
        >
          <div class="bar" :style="{ height: `${Math.max(4, (p.views / maxViews) * 100)}%` }" />
          <span class="bar-day">{{ p.day.slice(5) }}</span>
        </div>
      </div>
    </div>

    <div class="card pad" style="margin-top:20px;">
      <div class="card-head">
        <h2>热文 TOP {{ stats.top_posts.length }}</h2>
      </div>
      <div v-if="stats.top_posts.length === 0" class="muted" style="padding:12px 0;">
        暂无数据
      </div>
      <table v-else class="table">
        <thead>
          <tr>
            <th style="width:48px;">#</th>
            <th>标题</th>
            <th style="width:120px;">区间阅读</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(t, i) in stats.top_posts" :key="t.id">
            <td>{{ i + 1 }}</td>
            <td>
              <a class="title-link" :href="`/posts/${t.slug}/`" target="_blank">{{ t.title }}</a>
            </td>
            <td>{{ t.views }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>

  <div v-else class="card pad" style="margin-top:20px;">
    <p style="color:var(--ink-light);">数据加载失败</p>
  </div>
</template>

<style scoped>
.seg .active {
  background: var(--cinnabar);
  color: #fff;
  border-color: var(--cinnabar);
}
.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 180px;
  padding-top: 12px;
  overflow-x: auto;
}
.bar-col {
  flex: 1 1 0;
  min-width: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  gap: 6px;
}
.bar {
  width: 100%;
  max-width: 26px;
  border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, var(--cinnabar), rgba(194, 58, 48, 0.45));
}
.bar-day {
  font-size: 0.68rem;
  color: var(--ink-light);
  transform: rotate(-40deg);
  white-space: nowrap;
}
.muted {
  color: var(--ink-light);
  font-size: 0.85rem;
}
.title-link {
  color: var(--ink);
  text-decoration: none;
}
.title-link:hover {
  color: var(--cinnabar);
}
.corpus-row {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  padding-top: 8px;
}
.corpus-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.corpus-num {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--ink);
}
.select {
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
}
</style>