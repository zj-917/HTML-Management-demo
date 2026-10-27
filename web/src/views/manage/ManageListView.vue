<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { api, contentUrl } from '@/api'
import { useSiteStore } from '@/stores/site'
import VisibilityTag from '@/components/VisibilityTag.vue'
import {
  STATUS_LABEL,
  VISIBILITY_LABEL,
  type PageSummary,
  type PageStatus,
} from '@shared/types'

const router = useRouter()
const site = useSiteStore()

function statusTagType(status: string): string {
  if (status === 'published') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'info'
}

const loading = ref(false)
const busy = ref(false)
const items = ref<PageSummary[]>([])
const total = ref(0)
const inRecycleBin = ref(false)
const filters = reactive<{
  q: string
  status: string
  visibility: string
  categoryId: string
  page: number
}>({ q: '', status: '', visibility: '', categoryId: '', page: 1 })
const pageSize = 20
const RETENTION_DAYS = 30

const statusOptions: PageStatus[] = ['draft', 'pending', 'published', 'rejected']

async function fetchPages(): Promise<void> {
  loading.value = true
  try {
    const result = await api.managePages({
      q: filters.q || undefined,
      status: filters.status || undefined,
      visibility: filters.visibility || undefined,
      categoryId: filters.categoryId || undefined,
      deleted: inRecycleBin.value ? 'true' : undefined,
      page: filters.page,
      pageSize,
    })
    items.value = result.items
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function search(): void {
  filters.page = 1
  void fetchPages()
}

function resetFilters(): void {
  filters.q = ''
  filters.status = ''
  filters.visibility = ''
  filters.categoryId = ''
  filters.page = 1
  void fetchPages()
}

async function removePage(row: PageSummary): Promise<void> {
  await ElMessageBox.confirm(
    `确认删除「${row.title}」吗？删除后页面会立即下线并从所有入口移除，可在回收站恢复，${RETENTION_DAYS} 天后自动彻底删除。`,
    '删除确认',
    { type: 'warning', confirmButtonText: '移到回收站', cancelButtonText: '取消' },
  )
  try {
    await api.deletePage(row.id)
    ElMessage.success('已移到回收站')
    await fetchPages()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}

async function restorePage(row: PageSummary): Promise<void> {
  busy.value = true
  try {
    await api.restorePage(row.id)
    ElMessage.success('已从回收站恢复')
    await fetchPages()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  } finally {
    busy.value = false
  }
}

async function purgePage(row: PageSummary): Promise<void> {
  await ElMessageBox.confirm(
    `确认彻底删除「${row.title}」吗？记录与磁盘文件都会被永久清除，无法恢复。`,
    '彻底删除',
    { type: 'error', confirmButtonText: '永久删除', cancelButtonText: '取消' },
  )
  busy.value = true
  try {
    await api.purgePage(row.id)
    ElMessage.success('已彻底删除')
    await fetchPages()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  } finally {
    busy.value = false
  }
}

function switchView(next: boolean): void {
  inRecycleBin.value = next
  filters.status = ''
  filters.page = 1
  void fetchPages()
}

function openDetail(row: PageSummary): void {
  void router.push({ name: 'manage-detail', params: { id: row.id } })
}

function viewLive(row: PageSummary): void {
  void api.trackView(row.slug).catch(() => undefined)
  window.open(contentUrl(row.slug), '_blank', 'noopener')
}

onMounted(async () => {
  await site.load().catch(() => undefined)
  await fetchPages()
})
</script>

<template>
  <div class="manage">
    <header class="manage__head">
      <h2 class="hmp-page-title">页面管理</h2>
      <div class="manage__head-right">
        <el-radio-group :model-value="inRecycleBin" size="small" @change="switchView($event as boolean)">
          <el-radio-button :value="false">页面列表</el-radio-button>
          <el-radio-button :value="true">回收站</el-radio-button>
        </el-radio-group>
        <el-button v-if="!inRecycleBin" type="primary" @click="router.push({ name: 'upload' })">上传新页面</el-button>
      </div>
    </header>

    <el-alert
      v-if="inRecycleBin"
      type="info"
      show-icon
      :closable="false"
      class="manage__alert"
      :title="`回收站中的页面已从所有入口移除，保留 ${RETENTION_DAYS} 天后自动彻底删除。在保留期内可随时恢复。`"
    />

    <el-card shadow="never" class="manage__filters">
      <div class="filter-grid">
        <el-input
          v-model="filters.q"
          placeholder="搜索标题、描述或 slug"
          clearable
          @keyup.enter="search"
        />
        <el-select v-model="filters.status" placeholder="全部状态" clearable @change="search">
          <el-option
            v-for="status in statusOptions"
            :key="status"
            :label="STATUS_LABEL[status]"
            :value="status"
          />
        </el-select>
        <el-select v-model="filters.visibility" placeholder="全部可见性" clearable @change="search">
          <el-option
            v-for="(label, value) in VISIBILITY_LABEL"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select v-model="filters.categoryId" placeholder="全部分类" clearable @change="search">
          <el-option v-for="item in site.categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="items" stripe>
        <el-table-column label="页面" min-width="220">
          <template #default="{ row }">
            <div class="cell-title">{{ row.title }}</div>
            <div class="cell-sub">/{{ row.slug }}</div>
          </template>
        </el-table-column>

        <el-table-column label="可见性" width="140">
          <template #default="{ row }">
            <VisibilityTag :visibility="row.visibility" />
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.status)" effect="plain">
              {{ STATUS_LABEL[row.status as PageStatus] }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="分类" width="120" prop="categoryName">
          <template #default="{ row }">{{ row.categoryName ?? '未分类' }}</template>
        </el-table-column>

        <el-table-column label="创建人" width="120" prop="ownerName">
          <template #default="{ row }">{{ row.ownerName ?? '-' }}</template>
        </el-table-column>

        <el-table-column label="浏览" width="90">
          <template #default="{ row }">{{ row.viewCount }}</template>
        </el-table-column>

        <el-table-column label="更新时间" width="120">
          <template #default="{ row }">{{ dayjs(row.updatedAt).format('YYYY-MM-DD') }}</template>
        </el-table-column>

        <el-table-column v-if="inRecycleBin" label="删除时间" width="150">
          <template #default="{ row }">
            {{ row.deletedAt ? dayjs(row.deletedAt).format('YYYY-MM-DD') : '-' }}
          </template>
        </el-table-column>

        <el-table-column label="操作" :width="inRecycleBin ? 210 : 210" fixed="right">
          <template #default="{ row }">
            <template v-if="inRecycleBin">
              <el-button link type="success" :loading="busy" @click="restorePage(row)">恢复</el-button>
              <el-button link type="danger" :loading="busy" @click="purgePage(row)">彻底删除</el-button>
            </template>
            <template v-else>
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button
                v-if="row.status === 'published'"
                link
                type="success"
                @click="viewLive(row)"
              >
                打开
              </el-button>
              <el-button
                v-if="row.status === 'draft' || row.status === 'rejected'"
                link
                type="danger"
                @click="removePage(row)"
              >
                删除
              </el-button>
            </template>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="inRecycleBin ? '回收站是空的' : '还没有页面，先去上传一个'" />
        </template>
      </el-table>

      <div class="manage__pager">
        <el-pagination
          v-model:current-page="filters.page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          background
          @current-change="fetchPages"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.manage__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}


.manage__head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.manage__alert {
  margin-bottom: 14px;
}

.manage__filters {
  margin-bottom: 14px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.cell-title {
  font-weight: 600;
}

.cell-sub {
  color: var(--hmp-muted);
  font-size: 12px;
  margin-top: 2px;
}

.manage__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>