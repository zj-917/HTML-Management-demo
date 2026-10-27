<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <el-result icon="info" title="页面不存在" sub-title="你访问的地址可能已失效或被移动。">
    <template #extra>
      <el-button type="primary" @click="router.push({ name: 'portal' })">返回门户</el-button>
    </template>
  </el-result>
</template>