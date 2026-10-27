import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@shared/types'

const ADMIN: Role[] = ['admin']
const ALL_ROLES: Role[] = ['admin', 'member']

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'portal',
    component: () => import('@/views/PortalView.vue'),
    meta: { public: true, nav: true, order: 10, roles: ALL_ROLES, title: '页面门户', icon: 'Grid' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, nav: false, title: '登录' },
  },
  {
    path: '/preview/:slug',
    name: 'legacy-preview',
    component: () => import('@/views/LegacyPreviewView.vue'),
    meta: { public: true, nav: false, title: '预览方式已调整' },
  },
  {
    path: '/my-pages',
    name: 'my-pages',
    component: () => import('@/views/MyPagesView.vue'),
    meta: { requiresAuth: true, requiresManage: true, nav: true, order: 20, roles: ALL_ROLES, title: '我的页面', icon: 'DocumentCopy' },
  },
  {
    path: '/my-pages/:id',
    name: 'my-page-detail',
    component: () => import('@/views/manage/PageDetailView.vue'),
    meta: { requiresAuth: true, requiresManage: true, nav: false, title: '页面详情' },
  },
  {
    path: '/account',
    name: 'account',
    component: () => import('@/views/AccountView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 90,
      roles: ALL_ROLES,
      title: '我的账号',
      icon: 'User',
    },
  },
  {
    path: '/manage/pages',
    name: 'manage-pages',
    component: () => import('@/views/manage/ManageListView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 30,
      roles: ADMIN,
      title: '页面管理',
      icon: 'Files',
    },
  },
  {
    path: '/manage/upload',
    name: 'upload',
    component: () => import('@/views/manage/UploadView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 40,
      roles: ALL_ROLES,
      title: '上传页面',
      icon: 'UploadFilled',
    },
  },
  {
    path: '/manage/review',
    name: 'review',
    component: () => import('@/views/manage/ReviewView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 50,
      roles: ADMIN,
      title: '审核队列',
      icon: 'Finished',
    },
  },
  {
    path: '/manage/stats',
    name: 'stats',
    component: () => import('@/views/manage/StatsView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 60,
      roles: ADMIN,
      title: '使用统计',
      icon: 'TrendCharts',
    },
  },
  {
    path: '/manage/audit',
    name: 'audit',
    component: () => import('@/views/manage/AuditView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 70,
      roles: ADMIN,
      title: '审计日志',
      icon: 'Tickets',
    },
  },
  {
    path: '/manage/users',
    name: 'users',
    component: () => import('@/views/manage/UsersView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 75,
      roles: ADMIN,
      title: '用户管理',
      icon: 'UserFilled',
    },
  },
  {
    path: '/manage/settings',
    name: 'settings',
    component: () => import('@/views/manage/SettingsView.vue'),
    meta: {
      requiresAuth: true,
      requiresManage: true,
      nav: true,
      order: 80,
      roles: ADMIN,
      title: '基础配置',
      icon: 'Setting',
    },
  },
  {
    path: '/manage/pages/:id',
    name: 'manage-detail',
    component: () => import('@/views/manage/PageDetailView.vue'),
    meta: { requiresAuth: true, requiresManage: true, roles: ADMIN, nav: false, title: '页面详情' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true, nav: false, title: '页面不存在' },
  },
]

export interface NavItem {
  name: string
  title: string
  icon: string
  order: number
  roles: Role[]
}

export function navItemsOf(list: typeof routes): NavItem[] {
  return list
    .filter((route) => route.meta?.nav === true)
    .map((route) => ({
      name: String(route.name),
      title: String(route.meta?.title ?? ''),
      icon: String(route.meta?.icon ?? 'Document'),
      order: Number(route.meta?.order ?? 999),
      roles: (route.meta?.roles as Role[] | undefined) ?? ALL_ROLES,
    }))
    .sort((a, b) => a.order - b.order)
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  const site = useSiteStore()
  await site.load().catch(() => undefined)

  if (site.isExternal) {
    if (to.meta.requiresAuth || to.meta.requiresManage) {
      return { name: 'portal' }
    }
    if (to.name === 'login') return { name: 'portal' }
    return true
  }

  if (to.name === 'login') return true

  // 角色校验依赖 auth.user，而门户这类 public 路由没有 requiresAuth，
  // 如果只在校验 requiresAuth 时才 refresh，匿名用户访问门户会拿到 null，
  // 进而被判为「角色不符」而重定向回 portal —— 造成 / → / 无限重定向。
  const auth = useAuthStore()
  if (!auth.checked) await auth.refresh()

  if (to.meta.requiresAuth || to.meta.requiresManage) {
    if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
  }

  const required = to.meta.roles as Role[] | undefined
  if (required?.length && auth.user && !required.includes(auth.user.role)) {
    // 兜底：绝不把用户重定向到当前已经在的路由，否则 vue-router 会判定死循环
    if (to.name !== 'portal') return { name: 'portal' }
  }

  return true
})
