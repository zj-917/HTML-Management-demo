<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, type CategoryItem, type DepartmentItem } from '@/api'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'

const site = useSiteStore()
const auth = useAuthStore()

const departments = ref<DepartmentItem[]>([])
const categories = ref<CategoryItem[]>([])
const busy = ref(false)

const deptDialog = ref(false)
const categoryDialog = ref(false)
const deptForm = ref({ id: '', name: '', code: '' })
const categoryForm = ref({ id: '', name: '' })

async function load(): Promise<void> {
  busy.value = true
  try {
    const [deptList, categoryList] = await Promise.all([api.departments(), api.categories()])
    departments.value = deptList
    categories.value = categoryList
    await site.load(true)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    busy.value = false
  }
}

function openDept(item?: DepartmentItem): void {
  deptForm.value = item ? { id: item.id, name: item.name, code: item.code } : { id: '', name: '', code: '' }
  deptDialog.value = true
}

async function saveDept(): Promise<void> {
  if (!deptForm.value.name.trim()) {
    ElMessage.warning('请填写部门名称')
    return
  }
  busy.value = true
  try {
    if (deptForm.value.id) {
      await api.updateDepartment(deptForm.value.id, {
        name: deptForm.value.name.trim(),
        code: deptForm.value.code.trim() || undefined,
      })
    } else {
      await api.createDepartment({ name: deptForm.value.name.trim(), code: deptForm.value.code.trim() || undefined })
    }
    ElMessage.success('已保存')
    deptDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    busy.value = false
  }
}

async function removeDept(item: DepartmentItem): Promise<void> {
  await ElMessageBox.confirm(`确认删除部门「${item.name}」？`, '删除确认', { type: 'warning' })
  try {
    await api.deleteDepartment(item.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

function openCategory(item?: CategoryItem): void {
  categoryForm.value = item ? { id: item.id, name: item.name } : { id: '', name: '' }
  categoryDialog.value = true
}

async function saveCategory(): Promise<void> {
  if (!categoryForm.value.name.trim()) {
    ElMessage.warning('请填写分类名称')
    return
  }
  busy.value = true
  try {
    if (categoryForm.value.id) {
      await api.updateCategory(categoryForm.value.id, { name: categoryForm.value.name.trim() })
    } else {
      await api.createCategory({ name: categoryForm.value.name.trim() })
    }
    ElMessage.success('已保存')
    categoryDialog.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    busy.value = false
  }
}

async function removeCategory(item: CategoryItem): Promise<void> {
  await ElMessageBox.confirm(
    `确认删除分类「${item.name}」？该分类下的 ${item.pageCount} 个页面会变为未分类。`,
    '删除确认',
    { type: 'warning' },
  )
  try {
    await api.deleteCategory(item.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="settings">
    <header class="settings__head">
      <h2 class="hmp-page-title">基础配置</h2>
    </header>

    <el-alert
      v-if="!auth.isAdmin"
      type="warning"
      show-icon
      :closable="false"
      title="当前账号不是管理员，仅可查看"
      class="settings__alert"
    />

    <el-row :gutter="12">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span class="hmp-card-title">部门</span>
              <el-button v-if="auth.isAdmin" size="small" type="primary" @click="openDept()">新增</el-button>
            </div>
          </template>

          <el-table v-loading="busy" :data="departments" size="small">
            <el-table-column prop="name" label="部门名称" />
            <el-table-column prop="code" label="编码" width="130" />
            <el-table-column label="页面" width="70" align="right">
              <template #default="{ row }">{{ row.pageCount }}</template>
            </el-table-column>
            <el-table-column v-if="auth.isAdmin" width="110" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openDept(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="removeDept(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty><el-empty description="还没有部门" :image-size="60" /></template>
          </el-table>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span class="hmp-card-title">业务分类</span>
              <el-button v-if="auth.isAdmin" size="small" type="primary" @click="openCategory()">新增</el-button>
            </div>
          </template>

          <el-table v-loading="busy" :data="categories" size="small">
            <el-table-column prop="name" label="分类名称" />
            <el-table-column label="页面" width="70" align="right">
              <template #default="{ row }">{{ row.pageCount }}</template>
            </el-table-column>
            <el-table-column v-if="auth.isAdmin" width="110" align="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openCategory(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="removeCategory(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty><el-empty description="还没有分类" :image-size="60" /></template>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="deptDialog" :title="deptForm.id ? '编辑部门' : '新增部门'" width="420px">
      <el-form label-position="top">
        <el-form-item label="部门名称" required>
          <el-input v-model="deptForm.name" placeholder="例如：销售部" />
        </el-form-item>
        <el-form-item label="部门编码">
          <el-input v-model="deptForm.code" placeholder="留空则自动生成，例如 sales" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deptDialog = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="saveDept">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="categoryDialog" :title="categoryForm.id ? '编辑分类' : '新增分类'" width="420px">
      <el-form label-position="top">
        <el-form-item label="分类名称" required>
          <el-input v-model="categoryForm.name" placeholder="例如：销售报表" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="categoryDialog = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="saveCategory">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings__head {
  margin-bottom: 14px;
}


.settings__alert {
  margin-bottom: 14px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

</style>