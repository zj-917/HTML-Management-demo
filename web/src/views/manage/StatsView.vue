<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, contentUrl } from '@/api'
import VisibilityTag from '@/components/VisibilityTag.vue'
import TrendChart from '@/components/TrendChart.vue'
import type { StatsOverview, StatsTrend, Visibility } from '@shared/types'

const loading = ref(false)
const overview = ref<StatsOverview | null>(null)
const trend = ref<StatsTrend[]>([])
const days = ref(30)

const totalTrendViews = computed(() => trend.value.reduce((sum, item) => sum + item.count, 0))

async function load(): Promise<void> {
  loading.value = true
  try {
    const [overviewResult, trendResult] = await Promise.all([
      api.statsOverview(),
      api.statsTrend(days.value),
    ])
    overview.value = overviewResult
    trend.value = trendResult
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function refreshTrend(): Promise<void> {
  try {
    trend.value = await api.statsTrend(days.value)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  }
}

function openPage(slug: string): void {
  void api.trackView(slug).catch(() => undefined)
  window.open(contentUrl(slug), '_blank', 'noopener')
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="stats">
    <header class="stats__head">
      <h2 class="hmp-page-title">使用统计</h2>
      <el-select v-model="days" size="small" style="width: 130px" @change="refreshTrend">
        <el-option label="最近 7 天" :value="7" />
        <el-option label="最近 30 天" :value="30" />
        <el-option label="最近 90 天" :value="90" />
      </el-select>
    </header>

    <el-row :gutter="12" class="stats__cards">
      <el-col :xs="12" :sm="8" :md="4">
        <el-card shadow="never" class="stat-card">
          <div class="stat-card__value">{{ overview?.totalPages ?? 0 }}</div>
          <div class="stat-card__label">页面总数</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card shadow="never" class="stat-card">
          <div class="stat-card__value">{{ overview?.publishedPages ?? 0 }}</div>
          <div class="stat-card__label">已发布</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card shadow="never" class="stat-card">
          <div class="stat-card__value stat-card__value--warn">{{ overview?.pendingReview ?? 0 }}</div>
          <div class="stat-card__label">待审核</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card shadow="never" class="stat-card">
          <div class="stat-card__value">{{ overview?.totalViews ?? 0 }}</div>
          <div class="stat-card__label">累计浏览</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card shadow="never" class="stat-card">
          <div class="stat-card__value">{{ totalTrendViews }}</div>
          <div class="stat-card__label">近 {{ days }} 天浏览</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card shadow="never" class="stat-card">
          <div class="stat-card__value">{{ overview?.internalPages ?? 0 }}</div>
          <div class="stat-card__label">仅内网页面</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12">
      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header><span class="hmp-card-title">访问趋势</span></template>
          <TrendChart v-if="trend.length" :data="trend" />
          <el-empty v-else description="暂无访问数据" :image-size="70" />
        </el-card>
      </el-col>

      <el-col :xs="24" :md="10">
        <el-card shadow="never">
          <template #header><span class="hmp-card-title">最常访问</span></template>
          <div v-if="overview?.topPages?.length" class="top-list">
            <div
              v-for="(item, index) in overview.topPages.slice(0, 8)"
              :key="item.id"
              class="top-list__item"
              @click="openPage(item.slug)"
            >
              <span class="top-list__rank" :class="{ 'top-list__rank--top': index < 3 }">{{ index + 1 }}</span>
              <span class="top-list__name hmp-ellipsis">{{ item.title }}</span>
              <VisibilityTag v-if="'visibility' in item" :visibility="item.visibility as Visibility" />
              <span class="top-list__count">{{ item.viewCount }}</span>
            </div>
          </div>
          <el-empty v-else description="暂无访问数据" :image-size="70" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span class="hmp-card-title">按业务分类</span></template>
          <el-table :data="overview?.byCategory ?? []" size="small" :show-header="false">
            <el-table-column prop="categoryName" />
            <el-table-column width="90" align="right">
              <template #default="{ row }">{{ row.count }} 个</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span class="hmp-card-title">按归属部门</span></template>
          <el-table :data="overview?.byDepartment ?? []" size="small" :show-header="false">
            <el-table-column prop="departmentName" />
            <el-table-column width="90" align="right">
              <template #default="{ row }">{{ row.count }} 个</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.stats__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}


.stats__cards {
  margin-bottom: 12px;
}

.stat-card {
  text-align: center;
}

.stat-card__value {
  font-size: 24px;
  font-weight: 700;
}

.stat-card__value--warn {
  color: var(--hmp-warning);
}

.stat-card__label {
  font-size: 12px;
  color: var(--hmp-muted);
  margin-top: 4px;
}


.top-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.top-list__item {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;
}

.top-list__item:hover .top-list__name {
  color: var(--hmp-primary);
}

.top-list__rank {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--hmp-surface-sunken);
  color: var(--hmp-muted);
  font-size: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.top-list__rank--top {
  background: var(--hmp-primary);
  color: var(--hmp-surface-overlay);
}

.top-list__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.top-list__count {
  color: var(--hmp-muted);
  font-size: 12px;
  flex-shrink: 0;
}
</style>