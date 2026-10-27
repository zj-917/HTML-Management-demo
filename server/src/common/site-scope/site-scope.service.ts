import { Global, Injectable, Module } from '@nestjs/common'
import { loadSitesConfig, type SitesConfig, type SiteDefinition } from '../config'

@Injectable()
export class SiteScopeService {
  private readonly config: SitesConfig = loadSitesConfig()

  get all(): SiteDefinition[] {
    return this.config.sites
  }

  get defaultSite(): SiteDefinition {
    const site = this.config.sites.find((item) => item.id === this.config.defaultSiteId)
    if (!site) throw new Error(`default site "${this.config.defaultSiteId}" not found`)
    return site
  }

  get ports(): Record<string, number> {
    return this.config.ports
  }

  get prodHosts(): Record<string, string> {
    return this.config.prodHosts
  }

  get raw(): SitesConfig {
    return this.config
  }
}

@Global()
@Module({
  providers: [SiteScopeService],
  exports: [SiteScopeService],
})
export class SiteScopeModule {}