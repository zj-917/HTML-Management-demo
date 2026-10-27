<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import PasswordChangeForm from '@/components/PasswordChangeForm.vue'
import { ROLE_LABEL } from '@shared/types'

const auth = useAuthStore()

const user = computed(() => auth.user)
const initial = computed(() => (user.value?.name ?? '?').trim().slice(0, 1).toUpperCase())

const nameOpen = ref(false)
const nameFormRef = ref<FormInstance>()
const nameForm = reactive({ name: '' })
const busy = ref(false)

const nameRules: FormRules = {
  name: [
    { required: true, message: '请填写姓名', trigger: 'blur' },
    { max: 40, message: '姓名不能超过 40 个字符', trigger: 'blur' },
  ],
}

function openNameDialog(): void {
  nameForm.name = user.value?.name ?? ''
  nameOpen.value = true
}

async function submitName(): Promise<void> {
  const form = nameFormRef.value
  if (!form) return
  const valid = await form.validate().catch(() => false)
  if (!valid) return
  busy.value = true
  try {
    await api.updateProfile(nameForm.name)
    await auth.refresh()
    nameOpen.value = false
    ElMessage.success('姓名已更新')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await auth.refresh().catch(() => undefined)
})
</script>

<template>
  <div class="account">
    <h2 class="hmp-page-title">我的账号</h2>

    <div class="account__grid">
      <el-card shadow="never" class="account__card">
        <template #header>
          <div class="card-head">
            <span>个人信息</span>
            <el-button link type="primary" @click="openNameDialog">修改姓名</el-button>
          </div>
        </template>

        <div class="profile">
          <div class="profile__avatar">{{ initial }}</div>
          <div class="profile__main">
            <div class="profile__name">{{ user?.name ?? '-' }}</div>
            <div class="profile__mail">{{ user?.email ?? '-' }}</div>
          </div>
        </div>

        <el-descriptions :column="1" border size="small" class="profile__desc">
          <el-descriptions-item label="角色">
            <el-tag size="small" :type="user?.role === 'admin' ? 'success' : 'info'" effect="plain">
              {{ user ? ROLE_LABEL[user.role] : '-' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="部门">{{ user?.departmentName ?? '未归属部门' }}</el-descriptions-item>
          <el-descriptions-item label="登录邮箱">{{ user?.email ?? '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-alert
          type="info"
          show-icon
          :closable="false"
          class="profile__hint"
          title="角色、部门和登录邮箱由管理员维护。岗位变动或需要调整权限，请联系管理员。"
        />
      </el-card>

      <el-card shadow="never" class="account__card">
        <template #header>
          <div class="card-head">
            <span>安全设置</span>
          </div>
        </template>
        <PasswordChangeForm />
        <p class="security__hint">修改密码后，其他设备上已登录的会话会立即失效，当前设备不受影响。</p>
      </el-card>
    </div>

    <el-dialog v-model="nameOpen" title="修改姓名" width="400px" append-to-body>
      <el-form ref="nameFormRef" :model="nameForm" :rules="nameRules" label-width="72px" @submit.prevent>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="nameForm.name" maxlength="40" placeholder="请输入真实姓名" />
        </el-form-item>
      </el-form>
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="姓名会显示在页面创建人、审核记录和审计日志中；历史日志保留当时的姓名。"
      />
      <template #footer>
        <el-button @click="nameOpen = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="submitName">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.account__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
  align-items: start;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.profile {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.profile__avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
  color: var(--hmp-text-inverse);
  background: var(--el-color-primary);
  flex: none;
}

.profile__name {
  font-size: 18px;
  font-weight: 600;
}

.profile__mail {
  color: var(--hmp-muted);
  font-size: 13px;
  margin-top: 2px;
}

.profile__desc {
  margin-bottom: 14px;
}

.profile__hint {
  margin-top: 4px;
}

.security__hint {
  margin: 4px 0 0;
  color: var(--hmp-muted);
  font-size: 12px;
  line-height: 1.7;
}
</style>
