<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, contentUrl } from '@/api'

const route = useRoute()
const router = useRouter()

const slug = computed(() => String(route.params.slug ?? ''))
const available = ref<boolean | null>(null)
const title = ref<string>('')

function openPage(): void {
  window.open(contentUrl(slug.value), '_blank', 'noopener')
}

function goPortal(): void {
  void router.push({ name: 'portal' })
}

onMounted(async () => {
  try {
    const result = await api.pageDetail(slug.value)
    title.value = result.title
    available.value = true
  } catch {
    available.value = false
  }
})
</script>

<template>
  <div class="legacy">
    <el-result
      :icon="available === false ? 'warning' : 'info'"
      :title="available === false ? '页面不可访问' : '预览方式已调整'"
      :sub-title="
        available === false
          ? '该页面不存在、未发布，或当前访问入口没有权限查看。'
          : `「${title || slug}」现在直接在新标签页打开，平台不再提供内嵌预览。`
      "
    >
      <template #extra>
        <el-button v-if="available !== false" type="primary" @click="openPage">打开页面</el-button>
        <el-button @click="goPortal">返回门户</el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.legacy {
  max-width: 640px;
  margin: 40px auto;
}
</style>