import type { Request } from 'express'
import type { SiteDefinition } from './config'
import type { SessionUser } from '../shared'

export type SiteAwareRequest = Request & {
  site: SiteDefinition
  siteHost: string
  currentUser: SessionUser | null
  clientIp: string
}