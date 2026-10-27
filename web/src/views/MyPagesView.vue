<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { api, contentUrl } from '@/api'
import { useSiteStore } from '@/stores/site'
import VisibilityTag from '@/components/VisibilityTag.vue'
import {
  STATUS_LABEL,
  type PageSummary,
  type PageStatus,
} from '@shared/types'

const router = useRouter()
const site = useSiteStore()

const loading = ref(false)
const busy = ref(false)
const items = ref<PageSummary[]>([])
const total = ref(0)
const inRecycleBin = ref(false)
const filters = reactive({ q: '', status: '', page: 1 })
const pageSize = 20
const RETENTION_DAYS = 30

const requestDialog = ref(false)
const requestTarget = ref<PageSummary | null>(null)
const requestReason = ref('')

const statusOptions: PageStatus[] = ['draft', 'pending', 'published', 'rejected']

const rejectedPages = computed(() => items.value.filter((item) => item.unpublishDecisionNote))

function statusTagType(status: string): string {
  if (status === 'published') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'info'
}

async function fetchPages(): Promise<void> {
  loading.value = true
  try {
    const result = await api.myPages({
      q: filters.q || undefined,
      status: filters.status || undefined,
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

function openPage(row: PageSummary): void {
  void api.trackView(row.slug).catch(() => undefined)
  window.open(contentUrl(row.slug), '_blank', 'noopener')
}

function openDetail(row: PageSummary): void {
  void router.push({ name: 'my-page-detail', params: { id: row.id } })
}

async function submit(row: PageSummary): Promise<void> {
  await ElMessageBox.confirm(
    `确认把「${row.title}」提交审核吗？提交后需管理员审核通过才会对外可见。`,
    '提交审核',
    { type: 'info', confirmButtonText: '提交' },
  )
  busy.value = true
  try {
    await api.submitPage(row.id)
    ElMessage.success('已提交审核')
    await fetchPages()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function openRequestDialog(row: PageSummary): Promise<void> {
  requestTarget.value = row
  requestReason.value = ''
  requestDialog.value = true
}

async function submitRequest(): Promise<void> {
  const target = requestTarget.value
  if (!target) return
  if (requestReason.value.trim().length < 5) {
    ElMessage.warning('请填写至少 5 个字的下线原因，便于管理员判断')
    return
  }
  busy.value = true
  try {
    await api.requestUnpublish(target.id, requestReason.value.trim())
    ElMessage.success('下线申请已提交，页面在管理员批准前仍会保持在线')
    requestDialog.value = false
    await fetchPages()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败')
  } finally {
    busy.value = false
  }
}

async function withdrawRequest(row: PageSummary): Promise<void> {
  await ElMessageBox.confirm('撤回后下线申请将作废，页面继续保持在线。确认撤回？', '撤回下线申请', {
    type: 'warning',
  })
  busy.value = true
  try {
    await api.withdrawUnpublish(row.id)
    ElMessage.success('已撤回下线申请')
    await fetchPages()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
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

async function removePage(row: PageSummary): Promise<void> {
  await ElMessageBox.confirm(
    `确认删除「${row.title}」吗？删除后页面将从列表中移除，可在回收站恢复，${RETENTION_DAYS} 天后自动彻底删除。`,
    '删除确认',
    { type: 'warning', confirmButtonText: '移到回收站', cancelButtonText: '取消' },
  )
  busy.value = true
  try {
    await api.deletePage(row.id)
    ElMessage.success('已移到回收站')
    await fetchPages()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
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

onMounted(async () => {
  await site.load().catch(() => undefined)
  await fetchPages()
})
</script>

<template>
  <div class="mine">
    <header class="mine__head">
      <div>
        <h2 class="hmp-page-title">我的页面</h2>
        <p class="mine__hint">这里只显示你创建的页面。你可以上传新版本、提交审核、申请下线与删除；修改可见性需联系管理员。</p>
      </div>
      <div class="mine__head-right">
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
      class="mine__rejected"
      :title="`回收站中的页面已从所有入口移除，保留 ${RETENTION_DAYS} 天后自动彻底删除。`"
    />

    <el-card shadow="never" class="mine__filters">
      <div class="filter-grid">
        <el-input
          v-model="filters.q"
          placeholder="搜索我创建的页面"
          clearable
          @keyup.enter="search"
        />
        <el-select v-model="filters.status" placeholder="全部状态" clearable @change="search">
          <el-option v-for="status in statusOptions" :key="status" :label="STATUS_LABEL[status]" :value="status" />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
      </div>
    </el-card>

    <el-alert
      v-for="page in rejectedPages"
      :key="page.id"
      type="warning"
      show-icon
      :closable="false"
      class="mine__rejected"
      :title="`「${page.title}」的下线申请已被驳回`"
      :description="page.unpublishDecisionNote ?? ''"
    />

    <el-card v-loading="loading" shadow="never">
      <el-table :data="items" stripe>
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

        <el-table-column label="状态" width="170">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.status)" effect="plain">
              {{ STATUS_LABEL[row.status as PageStatus] }}
            </el-tag>
            <el-tag
              v-if="row.unpublishRequestedAt"
              size="small"
              type="warning"
              effect="dark"
              class="tag-gap"
            >
              下线申请中
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="分类" width="130" prop="categoryName">
          <template #default="{ row }">{{ row.categoryName ?? '未分类' }}</template>
        </el-table-column>

        <el-table-column label="浏览" width="80" prop="viewCount" />

        <el-table-column label="更新时间" width="120">
          <template #default="{ row }">{{ dayjs(row.updatedAt).format('YYYY-MM-DD') }}</template>
        </el-table-column>

        <el-table-column v-if="inRecycleBin" label="删除时间" width="150">
          <template #default="{ row }">
            {{ row.deletedAt ? dayjs(row.deletedAt).format('YYYY-MM-DD') : '-' }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="290" fixed="right">
          <template #default="{ row }">
            <el-button v-if="inRecycleBin" link type="success" :loading="busy" @click="restorePage(row)">
              恢复
            </el-button>
            <template v-else>
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button v-if="row.status === 'published'" link type="success" @click="openPage(row)">
                打开
              </el-button>
              <el-button
                v-if="row.status === 'draft' || row.status === 'rejected'"
                link
                type="warning"
                :loading="busy"
                @click="submit(row)"
              >
                提交审核
              </el-button>
              <el-button
                v-if="row.status === 'published' && !row.unpublishRequestedAt"
                link
                type="danger"
                @click="openRequestDialog(row)"
              >
                申请下线
              </el-button>
              <el-button
                v-else-if="row.unpublishRequestedAt"
                link
                type="info"
                :loading="busy"
                @click="withdrawRequest(row)"
              >
                撤回申请
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
          <el-empty v-if="inRecycleBin" description="回收站是空的" />
          <el-empty v-else description="你还没有创建过页面">
            <el-button type="primary" @click="router.push({ name: 'upload' })">上传第一个页面</el-button>
          </el-empty>
        </template>
      </el-table>

      <div v-if="total > pageSize" class="mine__pager">
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

    <el-dialog v-model="requestDialog" title="申请下线" width="480px">
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        title="提交后页面仍会继续在线"
        description="下线需要管理员批准后才会生效。如果内容需要立即下线，请直接联系管理员强制下线。"
        class="mine__dialog-alert"
      />
      <p class="mine__dialog-text">
        页面：<strong>{{ requestTarget?.title }}</strong>
      </p>
      <el-input
        v-model="requestReason"
        type="textarea"
        :rows="4"
        maxlength="300"
        show-word-limit
        placeholder="请说明下线原因，例如：数据已过期 / 改由新页面替代 / 包含不再适用内容"
      />
      <template #footer>
        <el-button @click="requestDialog = false">取消</el-button>
        <el-button type="danger" :loading="busy" @click="submitRequest">提交申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mine__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}


.mine__hint {
  margin: 6px 0 0;
  color: var(--hmp-muted);
  font-size: 13px;
  max-width: 640px;
}

.mine__filters {
  margin-bottom: 14px;
}

.filter-grid {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) 150px auto auto;
  align-items: center;
  gap: 10px;
}

.mine__head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mine__rejected {
  margin-bottom: 12px;
}

.mine__dialog-alert {
  margin-bottom: 12px;
}

.mine__dialog-text {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--hmp-muted);
}

.tag-gap {
  margin-left: 6px;
}

.cell-title {
  font-weight: 600;
}

.cell-sub {
  color: var(--hmp-muted);
  font-size: 12px;
  margin-top: 2px;
}

.mine__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

@media (max-width: 768px) {
  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
