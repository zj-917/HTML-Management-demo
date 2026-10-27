import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, type CategoryItem, type TagItem } from '@/api'
import type { AuthSiteInfo, SiteScope } from '@shared/types'

export const useSiteStore = defineStore('site', () => {
  const info = ref<AuthSiteInfo | null>(null)
  const categories = ref<CategoryItem[]>([])
  const tags = ref<TagItem[]>([])
  const loaded = ref(false)

  const scope = computed<SiteScope>(() => info.value?.scope ?? 'full')
  const isExternal = computed(() => scope.value === 'public-only')
  const canManage = computed(() => (info.value ? !info.value.anonymous : false))

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    const [siteInfo, categoryList, tagList] = await Promise.all([
      api.siteInfo(),
      api.categories().catch(() => [] as CategoryItem[]),
      api.tags().catch(() => [] as TagItem[]),
    ])
    info.value = siteInfo
    categories.value = categoryList
    tags.value = tagList
    loaded.value = true
  }

  function reset(): void {
    info.value = null
    categories.value = []
    tags.value = []
    loaded.value = false
  }

  return { info, categories, tags, loaded, scope, isExternal, canManage, load, reset }
})