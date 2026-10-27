import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PagesService } from './pages.service'

@Injectable()
export class RecycleBinService {
  private readonly logger = new Logger(RecycleBinService.name)

  constructor(private readonly pages: PagesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'purge-recycle-bin' })
  async purgeExpired(): Promise<void> {
    const retentionDays = Number(process.env.RECYCLE_RETENTION_DAYS ?? 30)
    try {
      const removed = await this.pages.purgeExpired(retentionDays)
      if (removed > 0) {
        this.logger.log(`回收站清理完成：移除 ${removed} 个超过 ${retentionDays} 天的页面`)
      }
    } catch (error) {
      this.logger.error(`回收站清理失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
