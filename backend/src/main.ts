import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { validateEnvironmentConfig } from './common/utils/config.validator';
import helmet from 'helmet';

async function bootstrap() {
  // Validate critical configuration (JWT_SECRET strength & presence)
  validateEnvironmentConfig();

  const app = await NestFactory.create(AppModule);

  // Security Headers (Helmet)
  app.use(helmet());

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Environment-driven CORS allowlist
  const rawOrigins =
    process.env.ALLOWED_ORIGINS ||
    'http://localhost:3000,http://localhost:3001';
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim());

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(
          new Error(`CORS Violation: Origin '${origin}' is not allowed.`),
        );
      }
    },
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(
    `🚀 DEMM CRM Security-Hardened API engine running on port ${port}`,
  );
}
bootstrap().catch(console.error);
