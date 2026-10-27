<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { api, type AuditItem } from '@/api'

const loading = ref(false)
const items = ref<AuditItem[]>([])
const total = ref(0)
const filters = reactive({ page: 1, pageSize: 20, action: '' })

const ACTION_LABEL: Record<string, string> = {
  login: '登录',
  logout: '登出',
  change_password: '修改密码',
  profile_update: '修改本人资料',
  user_create: '新增用户',
  user_update: '修改用户',
  user_reset_password: '重置密码',
  user_delete: '删除用户',
  upload: '上传页面',
  new_version: '上传新版本',
  submit: '提交审核',
  approve: '审核通过',
  reject: '审核驳回',
  publish: '发布',
  unpublish: '下线',
  delete: '删除页面',
  restore: '恢复页面',
  purge: '彻底删除',
  rollback: '版本回滚',
  visibility_change: '变更可见性',
  request_unpublish: '发起下线申请',
  withdraw_unpublish: '撤回下线申请',
  reject_unpublish: '驳回下线申请',
}

const FIELD_LABEL: Record<string, string> = {
  name: '姓名',
  role: '角色',
  department: '部门',
  active: '状态',
}

function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '空'
  if (field === 'active') return value === 'true' || value === true ? '启用' : '停用'
  if (field === 'role') return String(value) === 'admin' ? '管理员' : '普通员工'
  return String(value)
}

const actionOptions = Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await api.auditLogs({
      page: filters.page,
      pageSize: filters.pageSize,
      action: filters.action || undefined,
    })
    items.value = result.items
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function describe(item: AuditItem): string {
  const detail = item.detail ?? {}
  const parts: string[] = []
  if (detail.title) parts.push(String(detail.title))
  if (detail.comment) parts.push(`意见：${detail.comment}`)
  if (detail.from && detail.to) parts.push(`${detail.from} → ${detail.to}`)
  if (detail.versionNo) parts.push(`v${detail.versionNo}`)
  if (detail.sizeBytes) parts.push(`${(Number(detail.sizeBytes) / 1024).toFixed(1)} KB`)
  if (detail.targetEmail) parts.push(String(detail.targetEmail))

  const changes = detail.changes
  if (changes && typeof changes === 'object') {
    for (const [field, value] of Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>)) {
      const label = FIELD_LABEL[field] ?? field
      parts.push(`${label}：${formatChangeValue(field, value?.from)} → ${formatChangeValue(field, value?.to)}`)
    }
  }
  return parts.join(' · ')
}

onMounted(load)
</script>

<template>
  <div class="audit">
    <header class="audit__head">
      <h2 class="hmp-page-title">审计日志</h2>
      <el-select
        v-model="filters.action"
        placeholder="全部操作"
        clearable
        size="small"
        style="width: 160px"
        @change="filters.page = 1; load()"
      >
        <el-option v-for="item in actionOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
    </header>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="items" stripe size="small">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm:ss') }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="130" prop="userName" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ ACTION_LABEL[row.action] ?? row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="详情" min-width="240">
          <template #default="{ row }">{{ describe(row) || '-' }}</template>
        </el-table-column>
        <el-table-column label="来源 IP" width="130" prop="ip" />
        <template #empty><el-empty description="暂无审计记录" /></template>
      </el-table>

      <div class="audit__pager">
        <el-pagination
          v-model:current-page="filters.page"
          :page-size="filters.pageSize"
          :total="total"
          layout="total, prev, pager, next"
          background
          @current-change="load"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.audit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.audit__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>