import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaModule } from './common/prisma.module'
import { SiteScopeModule } from './common/site-scope/site-scope.service'
import { SiteScopeGuard } from './common/site-scope/site-scope.guard'
import { JwtAuthGuard } from './common/site-scope/jwt-auth.guard'
import { ManageGuard } from './common/site-scope/manage.guard'
import { RolesGuard } from './common/site-scope/roles.guard'
import { AuthModule } from './auth/auth.module'
import { AuditModule } from './audit/audit.module'
import { StorageModule } from './storage/storage.module'
import { UploadModule } from './upload/upload.module'
import { PagesModule } from './pages/pages.module'
import { MetaModule } from './meta/meta.module'
import { UsersModule } from './users/users.module'
import { StatsModule } from './stats/stats.module'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    SiteScopeModule,
    AuthModule,
    AuditModule,
    StorageModule,
    UploadModule,
    PagesModule,
    MetaModule,
    UsersModule,
    StatsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SiteScopeGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ManageGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}