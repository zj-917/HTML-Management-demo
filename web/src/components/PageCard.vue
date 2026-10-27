<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import VisibilityTag from './VisibilityTag.vue'
import type { PageSummary } from '@shared/types'

const props = withDefaults(
  defineProps<{ page: PageSummary; showPrivate?: boolean; showDetail?: boolean }>(),
  { showPrivate: false, showDetail: false },
)

const emit = defineEmits<{
  (event: 'open', page: PageSummary): void
  (event: 'detail', page: PageSummary): void
}>()

const updatedAt = computed(() => dayjs(props.page.updatedAt).format('YYYY-MM-DD'))
const sizeText = computed(() => `${(props.page.sizeBytes / 1024).toFixed(1)} KB`)
</script>

<template>
  <el-card class="hmp-page-card" shadow="never" :body-style="{ padding: '14px' }" @click="emit('open', page)">
    <div class="card__head">
      <div class="card__title hmp-ellipsis" :title="page.title">{{ page.title }}</div>
      <VisibilityTag :visibility="page.visibility" />
    </div>

    <div class="card__summary hmp-clamp-2">{{ page.summary || '暂无描述' }}</div>

    <div class="card__meta">
      <el-tag v-if="page.categoryName" size="small" effect="plain">{{ page.categoryName }}</el-tag>
      <el-tag v-for="tag in page.tags.slice(0, 2)" :key="tag" size="small" effect="plain" type="info">
        #{{ tag }}
      </el-tag>
    </div>

    <div class="card__foot">
      <span>更新 {{ updatedAt }}</span>
      <span>{{ sizeText }}</span>
      <span v-if="showPrivate">v{{ page.versionNo }}</span>
      <span v-if="showPrivate">浏览 {{ page.viewCount }}</span>
      <el-button
        v-if="showDetail"
        class="card__detail"
        link
        type="primary"
        size="small"
        @click.stop="emit('detail', page)"
      >
        详情
      </el-button>
      <span v-else class="card__hint">点击卡片打开</span>
    </div>
  </el-card>
</template>

<style scoped>
.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card__title {
  font-weight: 600;
  font-size: 15px;
  flex: 1;
  min-width: 0;
}

.card__summary {
  color: var(--hmp-muted);
  font-size: 13px;
  margin-top: 8px;
  min-height: 38px;
}

.card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  min-height: 24px;
}

.card__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--hmp-border);
  color: var(--hmp-muted);
  font-size: 12px;
}

.card__detail {
  margin-left: auto;
}

.card__hint {
  margin-left: auto;
  opacity: 0.7;
}
</style>