import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

function resolveCorsOrigins(): string[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const fallback = isProduction ? '' : 'http://localhost:3000';
  const origins = (process.env.CORS_ORIGINS ?? fallback)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    throw new Error('credentials付きCORSではワイルドカードを使用できません');
  }
  if (isProduction && origins.length === 0) {
    throw new Error('本番環境ではCORS_ORIGINSの設定が必要です');
  }

  return [...new Set(origins)];
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const isProduction = process.env.NODE_ENV === 'production';

  // Graceful shutdown時にNestのlifecycle hookを実行する。
  app.enableShutdownHooks();

  // Global prefix (API バージョニング)
  app.setGlobalPrefix('api/v1');

  // CORS: 本番では明示されたOriginだけを許可する。
  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swaggerは本番ではデフォルト非公開。必要な期間だけ明示的に有効化する。
  if (!isProduction || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Herta API')
      .setDescription('Herta. Discord Community Operating System API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Herta API が起動しました (ポート: ${port})`);
}

bootstrap().catch((error: unknown) => {
  console.error('Herta API の起動に失敗しました', error);
  process.exitCode = 1;
});
