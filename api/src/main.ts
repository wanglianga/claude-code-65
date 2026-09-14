import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.setGlobalPrefix('api')
  app.enableCors()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.enableShutdownHooks()
  const port = Number(process.env.PORT || 4000)
  await app.listen(port, '0.0.0.0')
  console.log(`[api] listening on 0.0.0.0:${port}`)
}
bootstrap()
