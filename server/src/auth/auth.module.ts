import { Global, Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { SessionCacheService } from './session-cache.service'

const signOptions = {
  expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
} as unknown as JwtModuleOptions['signOptions']

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'change-me-to-a-long-random-string-at-least-32-chars',
      signOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionCacheService],
  exports: [AuthService, SessionCacheService],
})
export class AuthModule {}