import { Module } from '@nestjs/common'
import { PagesService } from './pages.service'
import { PagesController } from './pages.controller'
import { ManagePagesController } from './manage-pages.controller'
import { MyPagesController } from './my-pages.controller'
import { RecycleBinService } from './recycle-bin.service'

@Module({
  controllers: [PagesController, ManagePagesController, MyPagesController],
  providers: [PagesService, RecycleBinService],
  exports: [PagesService],
})
export class PagesModule {}