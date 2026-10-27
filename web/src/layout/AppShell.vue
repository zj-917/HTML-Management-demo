<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'
import PasswordChangeForm from '@/components/PasswordChangeForm.vue'
import { navItemsOf, routes } from '@/router'
import { BP_SIDEBAR } from '@/constants/breakpoints'
import { ROLE_LABEL } from '@shared/types'

const site = useSiteStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const COLLAPSE_KEY = 'hmp.nav.collapsed'

const isMobile = ref(false)
const drawerOpen = ref(false)
const collapsed = ref(false)

const allNavItems = navItemsOf(routes)
const navItems = computed(() => {
  if (site.isExternal) return allNavItems.filter((item) => item.name === 'portal')
  const role = auth.user?.role
  if (!role) return allNavItems.filter((item) => item.name === 'portal')
  return allNavItems.filter((item) => item.roles.includes(role))
})
const hasSidebar = computed(() => navItems.value.length > 0)
const siteLabel = computed(() => (site.isExternal ? '外网门户' : '内网门户'))
const currentTitle = computed(() => String(route.meta?.title ?? '页面门户'))

const activeMenu = computed(() => {
  const name = String(route.name ?? '')
  if (name === 'manage-detail') return 'manage-pages'
  if (name === 'my-page-detail') return 'my-pages'
  return name
})

const asideWidth = computed(() => (collapsed.value ? '64px' : '220px'))

function isCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(COLLAPSE_KEY) === '1'
}

function toggleCollapse(): void {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0')
  } catch {
    /* 隐私模式下忽略 */
  }
}

function syncViewport(): void {
  isMobile.value = window.innerWidth < BP_SIDEBAR
  if (!isMobile.value) drawerOpen.value = false
}

function handleSelect(name: string): void {
  drawerOpen.value = false
  void router.push({ name })
}

async function handleLogout(): Promise<void> {
  await auth.logout()
  auth.reset()
  site.reset()
  ElMessage.success('已退出登录')
  drawerOpen.value = false
  await router.push({ name: 'portal' })
}

/* ---- 修改密码 ---- */
const pwdDialogOpen = ref(false)
const pwdFormRef = ref<{ submit: () => Promise<void> }>()

function openPasswordDialog(): void {
  pwdDialogOpen.value = true
}

function goAccount(): void {
  drawerOpen.value = false
  void router.push({ name: 'account' })
}

onMounted(() => {
  collapsed.value = isCollapsed()
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
  document.body.style.overflow = ''
})

watch(drawerOpen, (open) => {
  document.body.style.overflow = open && isMobile.value ? 'hidden' : ''
})
</script>

<template>
  <div class="shell" :class="{ 'shell--sidebar': hasSidebar && !isMobile }">
    <aside v-if="hasSidebar && !isMobile" class="sidebar" :style="{ width: asideWidth }">
      <RouterLink
        class="sidebar__brand"
        :class="{ 'sidebar__brand--mini': collapsed }"
        :to="{ name: 'portal' }"
      >
        <span class="sidebar__mark">H</span>
        <span v-if="!collapsed" class="sidebar__name">HTML 管理平台</span>
      </RouterLink>

      <el-menu
        class="sidebar__menu"
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        @select="handleSelect"
      >
        <el-menu-item v-for="item in navItems" :key="item.name" :index="item.name">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>

      <button
        class="sidebar__toggle"
        type="button"
        :title="collapsed ? '展开导航' : '收起导航'"
        @click="toggleCollapse"
      >
        <el-icon><component :is="collapsed ? 'DArrowRight' : 'DArrowLeft'" /></el-icon>
        <span v-if="!collapsed">收起导航</span>
      </button>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="topbar__left">
          <el-button v-if="isMobile && hasSidebar" text class="topbar__menu-btn" @click="drawerOpen = true">
            <el-icon :size="20"><Menu /></el-icon>
          </el-button>
          <RouterLink v-if="isMobile || !hasSidebar" class="topbar__brand" :to="{ name: 'portal' }">
            <span class="sidebar__mark">H</span>
            <span class="topbar__name">HTML 管理平台</span>
          </RouterLink>
          <span v-if="!isMobile" class="topbar__title">{{ currentTitle }}</span>
        </div>

        <div class="topbar__right">
          <el-tag :type="site.isExternal ? 'success' : 'warning'" size="small" effect="dark" round>
            {{ siteLabel }}
          </el-tag>

          <template v-if="auth.isLoggedIn && auth.user">
            <el-dropdown trigger="click">
              <span class="topbar__user">
                {{ auth.user.name }}
                <el-tag size="small" effect="plain">{{ ROLE_LABEL[auth.user.role] }}</el-tag>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item disabled>{{ auth.user.departmentName ?? '未归属部门' }}</el-dropdown-item>
                  <el-dropdown-item disabled>{{ auth.user.email }}</el-dropdown-item>
                  <el-dropdown-item @click="goAccount">我的账号</el-dropdown-item>
                  <el-dropdown-item @click="openPasswordDialog">修改密码</el-dropdown-item>
                  <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <RouterLink v-else-if="!site.isExternal" :to="{ name: 'login' }">
            <el-button type="primary" size="small">登录</el-button>
          </RouterLink>
          <el-tag v-else type="info" size="small" effect="plain">匿名访问</el-tag>
        </div>
      </header>

      <main class="content">
        <slot />
      </main>
    </div>

    <el-drawer
      v-if="hasSidebar"
      v-model="drawerOpen"
      direction="ltr"
      size="240px"
      :with-header="false"
    >
      <div class="drawer__brand">
        <span class="sidebar__mark">H</span>
        <span class="sidebar__name">HTML 管理平台</span>
      </div>
      <el-menu :default-active="activeMenu" @select="handleSelect">
        <el-menu-item v-for="item in navItems" :key="item.name" :index="item.name">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-drawer>

    <el-dialog v-model="pwdDialogOpen" title="修改密码" width="380px" append-to-body destroy-on-close>
      <PasswordChangeForm ref="pwdFormRef" :show-actions="false" @done="pwdDialogOpen = false" />
      <template #footer>
        <el-button @click="pwdDialogOpen = false">取消</el-button>
        <el-button type="primary" @click="pwdFormRef?.submit()">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  background: var(--hmp-surface-base);
}

.shell--sidebar {
  display: flex;
  align-items: stretch;
}

.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--hmp-surface-inverse);
  transition: width 0.2s ease;
  overflow: hidden;
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--hmp-header-height);
  padding: 0 16px;
  color: var(--hmp-text-inverse);
  text-decoration: none;
  flex-shrink: 0;
  border-bottom: 1px solid var(--hmp-sidebar-border);
}

.sidebar__brand--mini {
  padding: 0;
  justify-content: center;
}

.sidebar__mark {
  width: 28px;
  height: 28px;
  border-radius: var(--hmp-radius-lg);
  background: var(--hmp-primary);
  color: var(--hmp-text-inverse);
  display: grid;
  place-items: center;
  font-family: var(--hmp-font-serif);
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
}

.sidebar__name {
  font-family: var(--hmp-font-serif);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.sidebar__menu {
  flex: 1;
  border-right: none;
  background: transparent;
  padding: 8px;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar__toggle {
  margin: 8px;
  padding: 9px 0;
  border: none;
  border-radius: 6px;
  background: var(--hmp-sidebar-hover);
  color: var(--hmp-sidebar-text);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.sidebar__toggle:hover {
  background: var(--hmp-sidebar-active);
  color: var(--hmp-text-inverse);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: var(--hmp-header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 18px;
  background: var(--hmp-surface-overlay);
  border-bottom: 1px solid var(--hmp-border);
  position: sticky;
  top: 0;
  z-index: 100;
}

.topbar__left,
.topbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--hmp-text);
}

.topbar__name {
  font-family: var(--hmp-font-serif);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.topbar__title {
  font-weight: 600;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar__menu-btn {
  padding: 6px;
}

.topbar__user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  outline: none;
  white-space: nowrap;
}

.content {
  flex: 1;
  width: 100%;
  max-width: var(--hmp-content-max);
  margin: 0 auto;
  padding: 18px 16px 40px;
}

.drawer__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 12px;
  border-bottom: 1px solid var(--hmp-border);
  margin-bottom: 8px;
}

/* ---------------------------------------------------------------
   折叠态
   注意：这里必须写成普通 scoped 选择器，不能用 :deep()。
   :deep(X) 会被编译成 "[data-v-hash] X"（祖先选择器），
   而 .sidebar__menu 本身就是带 data-v-hash 的元素，
   用 :deep() 时永远匹配不到。
   --------------------------------------------------------------- */
.sidebar__menu.el-menu--collapse {
  --el-menu-collapsed-width: 64px;
  width: 64px;
  padding: 8px 0;
  overflow: hidden;
  scrollbar-width: none;
}

.sidebar__menu.el-menu--collapse::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.sidebar__menu.el-menu--collapse .el-menu-item {
  padding: 0 !important;
  margin: 0 8px 2px;
  width: auto;
  height: 42px;
  line-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Element Plus 折叠态会在图标外包一层 el-menu-tooltip__trigger，
   该层自带 padding: 0 20px，会把图标右推。这里必须用 :deep()，
   因为该元素是子组件内部节点，不会继承本组件的 data-v-hash。 */
.sidebar__menu.el-menu--collapse :deep(.el-menu-tooltip__trigger) {
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
}

.sidebar__menu.el-menu--collapse :deep(.el-icon) {
  width: 24px;
  margin: 0;
}

.sidebar__menu .el-menu-item {
  color: var(--hmp-sidebar-text);
  border-radius: 6px;
  margin-bottom: 2px;
  height: 42px;
  line-height: 42px;
}

.sidebar__menu .el-menu-item:hover {
  background: var(--hmp-sidebar-hover);
  color: var(--hmp-text-inverse);
}

.sidebar__menu .el-menu-item.is-active {
  background: var(--hmp-primary);
  color: var(--hmp-text-inverse);
}

@media (max-width: 900px) {
  .content {
    padding: 12px 10px 30px;
  }

  .topbar {
    padding: 0 12px;
  }
}
</style>