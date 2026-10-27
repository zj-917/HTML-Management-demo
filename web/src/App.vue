<script setup lang="ts">
import { onMounted } from 'vue'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'
import AppShell from '@/layout/AppShell.vue'

const site = useSiteStore()
const auth = useAuthStore()

onMounted(async () => {
  await site.load().catch(() => undefined)
  if (!site.isExternal && !auth.checked) {
    await auth.refresh()
  }
})
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
</template>