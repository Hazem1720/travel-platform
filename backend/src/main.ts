import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';

async function bootstrap() {
  // rawBody: the Stripe webhook (PAY-01) checks its signature against the
  // exact bytes Stripe sent; JSON parsing still works as before.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
