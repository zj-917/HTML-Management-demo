<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { api } from '@/api'

/**
 * 修改本人密码。顶部头像下拉与「我的账号」页共用这一个表单，
 * 避免两处校验规则 / 错误文案各写一套。
 *
 * 改密成功后服务端会换发新 cookie 并让其它设备的旧 cookie 立即失效，
 * 所以这里只需要提示，不需要前端重新登录。
 */
const props = withDefaults(defineProps<{ showActions?: boolean; submitLabel?: string }>(), {
  showActions: true,
  submitLabel: '更新密码',
})

const emit = defineEmits<{ done: [] }>()

const formRef = ref<FormInstance>()
const submitting = ref(false)
const form = ref({ current: '', next: '', confirm: '' })

function validateConfirm(_rule: unknown, value: string, callback: (error?: Error) => void): void {
  if (value !== form.value.next) callback(new Error('两次输入的新密码不一致'))
  else callback()
}

const rules: FormRules = {
  current: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  next: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '新密码至少 8 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' },
  ],
}

async function submit(): Promise<void> {
  const el = formRef.value
  if (!el) return
  try {
    await el.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    await api.changePassword(form.value.current, form.value.next)
    form.value = { current: '', next: '', confirm: '' }
    el.clearValidate()
    ElMessage.success('密码已更新')
    emit('done')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '修改失败')
  } finally {
    submitting.value = false
  }
}

defineExpose({ submit })
</script>

<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="88px" @submit.prevent>
    <el-form-item label="当前密码" prop="current">
      <el-input
        v-model="form.current"
        type="password"
        show-password
        placeholder="请输入当前密码"
        autocomplete="current-password"
      />
    </el-form-item>
    <el-form-item label="新密码" prop="next">
      <el-input
        v-model="form.next"
        type="password"
        show-password
        placeholder="至少 8 位"
        autocomplete="new-password"
      />
    </el-form-item>
    <el-form-item label="确认新密码" prop="confirm">
      <el-input
        v-model="form.confirm"
        type="password"
        show-password
        placeholder="再次输入新密码"
        autocomplete="new-password"
      />
    </el-form-item>
    <el-form-item v-if="props.showActions">
      <el-button type="primary" :loading="submitting" @click="submit">{{ props.submitLabel }}</el-button>
    </el-form-item>
  </el-form>
</template>
