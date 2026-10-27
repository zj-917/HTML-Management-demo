<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import dayjs from 'dayjs'
import { api, type UserItem } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { ROLE_LABEL, type Role } from '@shared/types'

const auth = useAuthStore()

const loading = ref(false)
const busy = ref(false)
const items = ref<UserItem[]>([])
const total = ref(0)
const departments = ref<{ id: string; name: string }[]>([])

const pageSize = 20
const filters = reactive<{
  q: string
  role: string
  departmentId: string
  active: string
  page: number
}>({ q: '', role: '', departmentId: '', active: 'true', page: 1 })

const activeOptions = [
  { value: 'true', label: '启用中' },
  { value: 'false', label: '已停用' },
  { value: 'all', label: '全部状态' },
]

const roleOptions: Role[] = ['admin', 'member']

function isSelf(row: UserItem): boolean {
  return row.id === auth.user?.id
}

async function fetchUsers(): Promise<void> {
  loading.value = true
  try {
    const result = await api.users({
      q: filters.q || undefined,
      role: filters.role || undefined,
      departmentId: filters.departmentId || undefined,
      active: (filters.active || undefined) as 'true' | 'false' | 'all' | undefined,
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
  void fetchUsers()
}

function resetFilters(): void {
  filters.q = ''
  filters.role = ''
  filters.departmentId = ''
  filters.active = 'true'
  filters.page = 1
  void fetchUsers()
}

/* ---------------- 新增用户 ---------------- */

const createOpen = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({ email: '', name: '', role: 'member' as Role, departmentId: '' })
const createRules: FormRules = {
  email: [
    { required: true, message: '请填写登录邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请填写姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

function openCreate(): void {
  createForm.email = ''
  createForm.name = ''
  createForm.role = 'member'
  createForm.departmentId = ''
  createOpen.value = true
}

async function submitCreate(): Promise<void> {
  const form = createFormRef.value
  if (!form) return
  const valid = await form.validate().catch(() => false)
  if (!valid) return

  busy.value = true
  try {
    const result = await api.createUser({
      email: createForm.email,
      name: createForm.name,
      role: createForm.role,
      departmentId: createForm.departmentId || null,
    })
    createOpen.value = false
    await fetchUsers()
    showPassword(result.user.name, result.initialPassword, '账号已创建')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建失败')
  } finally {
    busy.value = false
  }
}

/* ---------------- 编辑用户 ---------------- */

const editOpen = ref(false)
const editFormRef = ref<FormInstance>()
const editing = ref<UserItem | null>(null)
const editForm = reactive({ name: '', role: 'member' as Role, departmentId: '' })
const editRules: FormRules = {
  name: [{ required: true, message: '请填写姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

const editingSelf = computed(() => editing.value !== null && isSelf(editing.value))
const departmentChanged = computed(
  () => editing.value !== null && (editForm.departmentId || null) !== editing.value.departmentId,
)
const roleChanged = computed(
  () => editing.value !== null && editForm.role !== editing.value.role,
)

function openEdit(row: UserItem): void {
  editing.value = row
  editForm.name = row.name
  editForm.role = row.role
  editForm.departmentId = row.departmentId ?? ''
  editOpen.value = true
}

async function submitEdit(): Promise<void> {
  const form = editFormRef.value
  const target = editing.value
  if (!form || !target) return
  const valid = await form.validate().catch(() => false)
  if (!valid) return

  busy.value = true
  try {
    const payload: { name?: string; role?: Role; departmentId?: string | null } = {}
    if (editForm.name !== target.name) payload.name = editForm.name
    if (editForm.role !== target.role) payload.role = editForm.role
    if ((editForm.departmentId || null) !== target.departmentId) {
      payload.departmentId = editForm.departmentId || null
    }
    if (Object.keys(payload).length === 0) {
      editOpen.value = false
      return
    }
    await api.updateUser(target.id, payload)
    editOpen.value = false
    await fetchUsers()
    if (isSelf(target)) await auth.refresh().catch(() => undefined)
    ElMessage.success('已保存')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    busy.value = false
  }
}

/* ---------------- 启停 / 重置密码 / 删除 ---------------- */

async function toggleActive(row: UserItem): Promise<void> {
  const next = !row.active
  await ElMessageBox.confirm(
    next
      ? `确认启用「${row.name}」吗？启用后该账号可以重新登录。`
      : `确认停用「${row.name}」吗？停用后该账号的所有已登录设备会立即下线，且无法再登录。`,
    next ? '启用账号' : '停用账号',
    { type: next ? 'info' : 'warning', confirmButtonText: next ? '启用' : '停用', cancelButtonText: '取消' },
  )
  busy.value = true
  try {
    await api.setUserActive(row.id, next)
    ElMessage.success(next ? '已启用' : '已停用')
    await fetchUsers()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function resetPassword(row: UserItem): Promise<void> {
  await ElMessageBox.confirm(
    `确认重置「${row.name}」的密码吗？重置后旧密码立即失效，该账号所有已登录设备会下线。`,
    '重置密码',
    { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' },
  )
  busy.value = true
  try {
    const result = await api.resetUserPassword(row.id)
    showPassword(row.name, result.password, '密码已重置')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '重置失败')
  } finally {
    busy.value = false
  }
}

async function removeUser(row: UserItem): Promise<void> {
  await ElMessageBox.confirm(
    `确认删除「${row.name}」吗？删除后该账号不可恢复（审计日志会保留）。`,
    '删除账号',
    { type: 'error', confirmButtonText: '永久删除', cancelButtonText: '取消' },
  )
  busy.value = true
  try {
    await api.deleteUser(row.id)
    ElMessage.success('已删除')
    await fetchUsers()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  } finally {
    busy.value = false
  }
}

/* ---------------- 一次性密码展示 ---------------- */

const passwordOpen = ref(false)
const passwordInfo = reactive({ name: '', password: '', title: '' })

function showPassword(name: string, password: string, title: string): void {
  passwordInfo.name = name
  passwordInfo.password = password
  passwordInfo.title = title
  passwordOpen.value = true
}

async function copyPassword(): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(passwordInfo.password)
    } else {
      throw new Error('clipboard unavailable')
    }
  } catch {
    const input = document.getElementById('hmp-one-time-password') as HTMLInputElement | null
    input?.select()
    document.execCommand('copy')
  }
  ElMessage.success('密码已复制')
}

onMounted(async () => {
  await auth.refresh().catch(() => undefined)
  await api
    .departmentOptions()
    .then((list) => (departments.value = list))
    .catch(() => undefined)
  await fetchUsers()
})
</script>

<template>
  <div class="users">
    <header class="users__head">
      <h2 class="hmp-page-title">用户管理</h2>
      <el-button type="primary" @click="openCreate">新增用户</el-button>
    </header>

    <el-card shadow="never" class="users__filters">
      <div class="filter-grid">
        <el-input
          v-model="filters.q"
          placeholder="搜索姓名或邮箱"
          clearable
          @keyup.enter="search"
        />
        <el-select v-model="filters.role" placeholder="全部角色" clearable @change="search">
          <el-option v-for="role in roleOptions" :key="role" :label="ROLE_LABEL[role]" :value="role" />
        </el-select>
        <el-select v-model="filters.departmentId" placeholder="全部部门" clearable @change="search">
          <el-option v-for="item in departments" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="filters.active" @change="search">
          <el-option v-for="item in activeOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="items" stripe>
        <el-table-column label="姓名" min-width="150">
          <template #default="{ row }">
            <span class="cell-name">{{ row.name }}</span>
            <el-tag v-if="isSelf(row)" size="small" type="warning" effect="plain" class="cell-tag">
              当前账号
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="邮箱" min-width="200" prop="email" />

        <el-table-column label="角色" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.role === 'admin' ? 'success' : 'info'" effect="plain">
              {{ ROLE_LABEL[row.role as Role] }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="部门" width="130">
          <template #default="{ row }">{{ row.departmentName ?? '未分配' }}</template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.active ? 'success' : 'danger'" effect="plain">
              {{ row.active ? '启用中' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="页面数" width="90">
          <template #default="{ row }">{{ row.pageCount }}</template>
        </el-table-column>

        <el-table-column label="创建时间" width="120">
          <template #default="{ row }">{{ dayjs(row.createdAt).format('YYYY-MM-DD') }}</template>
        </el-table-column>

        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <template v-if="!isSelf(row)">
              <el-button link type="warning" :disabled="busy" @click="resetPassword(row)">
                重置密码
              </el-button>
              <el-button link :type="row.active ? 'danger' : 'success'" :disabled="busy" @click="toggleActive(row)">
                {{ row.active ? '停用' : '启用' }}
              </el-button>
              <el-button
                v-if="!row.active"
                link
                type="danger"
                :disabled="busy"
                @click="removeUser(row)"
              >
                删除
              </el-button>
            </template>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty description="没有符合条件的用户" />
        </template>
      </el-table>

      <div class="users__pager">
        <el-pagination
          v-model:current-page="filters.page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          background
          @current-change="fetchUsers"
        />
      </div>
    </el-card>

    <!-- 新增用户 -->
    <el-dialog v-model="createOpen" title="新增用户" width="460px" append-to-body>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="88px">
        <el-form-item label="登录邮箱" prop="email">
          <el-input v-model="createForm.email" placeholder="例如 zhang.san@company.com" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="createForm.name" placeholder="员工真实姓名" maxlength="40" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option v-for="role in roleOptions" :key="role" :label="ROLE_LABEL[role]" :value="role" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="createForm.departmentId" placeholder="可不选（尚未定岗）" clearable style="width: 100%">
            <el-option v-for="item in departments" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="初始密码由系统生成，创建后一次性显示，请当面或通过可靠渠道转达给本人。"
        />
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 编辑用户 -->
    <el-dialog v-model="editOpen" title="编辑用户" width="460px" append-to-body>
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="88px">
        <el-form-item label="登录邮箱">
          <el-input :model-value="editing?.email ?? ''" disabled />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="editForm.name" maxlength="40" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="editForm.role" :disabled="editingSelf" style="width: 100%">
            <el-option v-for="role in roleOptions" :key="role" :label="ROLE_LABEL[role]" :value="role" />
          </el-select>
          <div v-if="editingSelf" class="form-hint">不能修改自己的角色，请让其他管理员操作。</div>
          <div v-else-if="roleChanged" class="form-hint form-hint--warn">
            管理员可执行审核、发布、删除和用户管理；变更立即生效。
          </div>
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="editForm.departmentId" placeholder="未分配" clearable style="width: 100%">
            <el-option v-for="item in departments" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-alert
          v-if="departmentChanged"
          type="warning"
          show-icon
          :closable="false"
          title="调岗后该员工的页面访问权立即随人变化，但其名下已发布页面配置的「指定部门可见」授权不会自动跟随，请核对。"
        />
      </el-form>
      <template #footer>
        <el-button @click="editOpen = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 一次性密码 -->
    <el-dialog v-model="passwordOpen" :title="passwordInfo.title" width="440px" append-to-body>
      <p class="password-note">
        请立即复制并转达给「{{ passwordInfo.name }}」。关闭后将无法再次查看，只能重新重置。
      </p>
      <div class="password-row">
        <el-input id="hmp-one-time-password" :model-value="passwordInfo.password" readonly />
        <el-button type="primary" @click="copyPassword">复制</el-button>
      </div>
      <template #footer>
        <el-button type="primary" @click="passwordOpen = false">我已转达，关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.users__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.users__filters {
  margin-bottom: 14px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.users__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.cell-name {
  font-weight: 600;
}

.cell-tag {
  margin-left: 8px;
}

.form-hint {
  color: var(--hmp-muted);
  font-size: 12px;
  line-height: 1.6;
  margin-top: 4px;
}

.form-hint--warn {
  color: var(--el-color-warning);
}

.password-note {
  margin: 0 0 12px;
  color: var(--hmp-muted);
  font-size: 13px;
  line-height: 1.7;
}

.password-row {
  display: flex;
  gap: 8px;
}
</style>
