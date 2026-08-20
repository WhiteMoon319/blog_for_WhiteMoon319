<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';

interface DailyPoint { day: string; views: number }
interface TopPost { id: number; title: string; slug: string; views: number }
interface TrendStats {
  days: number;
  start_day: string;
  end_day: string;
  total_views: number;
  daily: DailyPoint[];
  top_posts: TopPost[];
}

const DAY_OPTIONS = [7, 30, 90, 365];

const stats = ref<TrendStats | null>(null);
const loaded = ref(false);
const days = ref(30);

const maxViews = computed(() => Math.max(1, ...(stats.value?.daily.map((d) => d.views) ?? [0])));
const avgPerDay = computed(() =>
  stats.value ? Math.round((stats.value.total_views / stats.value.days) * 10) / 10 : 0,
);

async function load() {
  loaded.value = false;
  try {
    stats.value = await api.stats(days.value);
  } catch {
    stats.value = null;
  } finally {
    loaded.value = true;
  }
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
        @click="days = d; load()"
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
</style>