<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'

const auth = useAuthStore()
const site = useSiteStore()
const router = useRouter()
const route = useRoute()

const formRef = ref<FormInstance>()
const submitting = ref(false)
const form = ref({ email: '', password: '' })

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

const demoAccounts = [
  { role: '管理员', email: 'admin@hmp.local', password: 'admin123' },
  { role: '管理员2', email: 'admin2@hmp.local', password: 'admin2_123' },
  { role: '销售部员工', email: 'sales@hmp.local', password: 'sales123' },
]

function fill(account: (typeof demoAccounts)[number]): void {
  form.value.email = account.email
  form.value.password = account.password
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await auth.login(form.value.email, form.value.password)
    ElMessage.success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/manage/pages'
    await router.replace(redirect)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <el-card class="login__card" shadow="always">
      <h2 class="login__title">登录 HTML 管理平台</h2>
      <p class="login__hint">仅限公司内部访问。外部页面请通过外网门户浏览。</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="name@company.com" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="请输入密码"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button type="primary" class="login__submit" :loading="submitting" @click="submit">
          登录
        </el-button>
      </el-form>

      <el-divider>演示账号（点击填充）</el-divider>
      <div class="login__accounts">
        <el-button
          v-for="account in demoAccounts"
          :key="account.email"
          size="small"
          plain
          @click="fill(account)"
        >
          {{ account.role }}
        </el-button>
      </div>

      <div v-if="site.isExternal" class="login__warn">
        <el-alert type="warning" :closable="false" show-icon title="当前是外网站点，无管理入口" />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  justify-content: center;
  padding-top: 40px;
}

.login__card {
  width: 100%;
  max-width: 420px;
}

.login__title {
  margin: 0 0 6px;
  font-size: 20px;
}

.login__hint {
  margin: 0 0 18px;
  color: var(--hmp-muted);
  font-size: 13px;
}

.login__submit {
  width: 100%;
}

.login__accounts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.login__warn {
  margin-top: 16px;
}
</style>