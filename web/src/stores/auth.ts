import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'
import type { Role, SessionUser } from '@shared/types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null)
  const checked = ref(false)

  const isLoggedIn = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function refresh(): Promise<void> {
    try {
      user.value = await api.me()
    } catch {
      user.value = null
    } finally {
      checked.value = true
    }
  }

  async function login(email: string, password: string): Promise<void> {
    user.value = await api.login(email, password)
    checked.value = true
  }

  async function logout(): Promise<void> {
    await api.logout().catch(() => undefined)
    user.value = null
  }

  function reset(): void {
    user.value = null
    checked.value = false
  }

  return { user, checked, isLoggedIn, isAdmin, refresh, login, logout, reset }
})

export type { Role, SessionUser }