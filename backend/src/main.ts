import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { validateEnvironmentConfig } from './common/utils/config.validator';
import helmet from 'helmet';
import * as express from 'express';

async function bootstrap() {
  // Validate critical configuration (JWT_SECRET strength & presence)
  validateEnvironmentConfig();

  const app = await NestFactory.create(AppModule);

  // Security Headers (Helmet)
  app.use(helmet());

  // Raw body ONLY for the Stripe webhook route -- signature verification
  // needs the exact bytes Stripe sent, before any JSON parsing. Every
  // other route keeps Nest's default JSON body parser untouched.
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

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
