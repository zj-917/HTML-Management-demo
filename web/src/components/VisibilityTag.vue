<script setup lang="ts">
import { computed } from 'vue'
import { Lock, Share, OfficeBuilding } from '@element-plus/icons-vue'
import { VISIBILITY_LABEL, type Visibility } from '@shared/types'

const props = defineProps<{ visibility: Visibility }>()

const modifier = computed(() => `hmp-visibility--${props.visibility}`)
const icon = computed(() => {
  if (props.visibility === 'public') return Share
  if (props.visibility === 'dept') return OfficeBuilding
  return Lock
})
</script>

<template>
  <span class="hmp-visibility" :class="modifier">
    <el-icon :size="12"><component :is="icon" /></el-icon>
    {{ VISIBILITY_LABEL[props.visibility] }}
  </span>
</template>