import { Global, Module } from '@nestjs/common'
import { StorageService } from './storage.service'
import { PublisherService } from './publisher.service'

@Global()
@Module({
  providers: [StorageService, PublisherService],
  exports: [StorageService, PublisherService],
})
export class StorageModule {}