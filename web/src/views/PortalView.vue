<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, contentUrl } from '@/api'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'
import PageCard from '@/components/PageCard.vue'
import type { PageSummary } from '@shared/types'

const site = useSiteStore()
const auth = useAuthStore()
const router = useRouter()

const loading = ref(false)
const pages = ref<PageSummary[]>([])
const total = ref(0)
const keyword = ref('')
const selectedCategory = ref<string>('')
const selectedTag = ref('')
const page = ref(1)
const pageSize = 12

const query = reactive({ q: '', categoryId: '', tag: '', page: 1 })

const showPrivateMeta = computed(() => !site.isExternal)
const visibleTags = computed(() => site.tags.slice(0, 12))

async function fetchPages(): Promise<void> {
  loading.value = true
  try {
    const result = await api.listPages({
      q: query.q || undefined,
      categoryId: query.categoryId || undefined,
      tag: query.tag || undefined,
      page: query.page,
      pageSize,
    })
    pages.value = result.items
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function submitSearch(): void {
  query.q = keyword.value.trim()
  query.page = 1
  void fetchPages()
}

function pickCategory(id: string): void {
  query.categoryId = selectedCategory.value === id ? '' : id
  selectedCategory.value = query.categoryId
  query.page = 1
  void fetchPages()
}

function pickTag(name: string): void {
  query.tag = selectedTag.value === name ? '' : name
  selectedTag.value = query.tag
  query.page = 1
  void fetchPages()
}

function changePage(value: number): void {
  query.page = value
  void fetchPages()
}

function openPage(item: PageSummary): void {
  void api.trackView(item.slug).catch(() => undefined)
  window.open(contentUrl(item.slug), '_blank', 'noopener')
}

function openDetail(item: PageSummary): void {
  const routeName = auth.isAdmin ? 'manage-detail' : 'my-page-detail'
  void router.push({ name: routeName, params: { id: item.id } })
}

watch(page, changePage)

onMounted(async () => {
  await site.load().catch(() => undefined)
  await fetchPages()
})
</script>

<template>
  <div class="portal">
    <section class="portal__hero">
      <h1 class="portal__title">公司 HTML 页面总览</h1>
      <p class="portal__desc">
        <template v-if="site.isExternal">
          这里汇总了公司对外公开的 HTML 页面，点击卡片即可在新标签页查看。
        </template>
        <template v-else>
          所有部门制作的 HTML 页面都在这里统一管理，按分类浏览或搜索关键词，找到后可直接打开。
        </template>
      </p>

      <div class="portal__search">
        <el-input
          v-model="keyword"
          placeholder="搜索页面标题、描述或标签"
          clearable
          size="large"
          @keyup.enter="submitSearch"
        >
          <template #append>
            <el-button :icon="undefined" @click="submitSearch">搜索</el-button>
          </template>
        </el-input>
      </div>
    </section>

    <section class="portal__filters">
      <div class="filter-row">
        <span class="filter-label">业务分类</span>
        <el-tag
          :type="selectedCategory === '' ? 'primary' : 'info'"
          :effect="selectedCategory === '' ? 'dark' : 'plain'"
          class="filter-chip"
          @click="pickCategory('')"
        >
          全部分类
        </el-tag>
        <el-tag
          v-for="item in site.categories"
          :key="item.id"
          :type="selectedCategory === item.id ? 'primary' : 'info'"
          :effect="selectedCategory === item.id ? 'dark' : 'plain'"
          class="filter-chip"
          @click="pickCategory(item.id)"
        >
          {{ item.name }} ({{ item.pageCount }})
        </el-tag>
      </div>

      <div v-if="visibleTags.length" class="filter-row">
        <span class="filter-label">标签</span>
        <el-tag
          v-for="tag in visibleTags"
          :key="tag.id"
          :type="selectedTag === tag.name ? 'success' : 'info'"
          :effect="selectedTag === tag.name ? 'dark' : 'plain'"
          class="filter-chip"
          @click="pickTag(tag.name)"
        >
          #{{ tag.name }}
        </el-tag>
      </div>
    </section>

    <section v-loading="loading" class="portal__list">
      <div v-if="pages.length" class="hmp-page-grid">
        <PageCard
          v-for="item in pages"
          :key="item.id"
          :page="item"
          :show-private="showPrivateMeta"
          :show-detail="!site.isExternal"
          @open="openPage"
          @detail="openDetail"
        />
      </div>

      <el-empty v-else-if="!loading" description="没有找到符合条件的页面" />
    </section>

    <section v-if="total > pageSize" class="portal__pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        background
        @current-change="changePage"
      />
    </section>
  </div>
</template>

<style scoped>
.portal__hero {
  /* 深墨到铁胆蓝，与侧栏同源，保持档案气质 */
  background: linear-gradient(135deg, var(--hmp-surface-inverse) 0%, var(--hmp-primary) 100%);
  color: var(--hmp-surface-overlay);
  border-radius: var(--hmp-radius-lg);
  padding: 28px 24px;
}

.portal__title {
  margin: 0;
  font-family: var(--hmp-font-serif);
  font-size: var(--hmp-text-2xl);
  letter-spacing: 0.02em;
}

.portal__desc {
  margin: 8px 0 18px;
  opacity: 0.9;
  font-size: 14px;
}

.portal__search {
  max-width: 560px;
}

.portal__filters {
  margin: 18px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 13px;
  color: var(--hmp-muted);
  min-width: 56px;
}

.filter-chip {
  cursor: pointer;
  user-select: none;
}

.portal__list {
  min-height: 220px;
}

.portal__pager {
  display: flex;
  justify-content: center;
  margin-top: 22px;
}
</style>