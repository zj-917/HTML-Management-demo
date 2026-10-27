import './load-env'
import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { loadSecurityHeaders } from './common/config'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false })
  const logger = new Logger('bootstrap')

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  )

  const headers = loadSecurityHeaders().api
  app.use((_req: unknown, res: { setHeader(key: string, value: string): void }, next: () => void) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
    next()
  })

  app.enableShutdownHooks()

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port, '0.0.0.0')
  logger.log(`api listening on http://0.0.0.0:${port}`)
}

void bootstrap()