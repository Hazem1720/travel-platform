import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { User, UserDocument } from '../users/schemas/user.schema';

// Run from the backend folder:  npx ts-node src/seed/seed-admin.ts
// Needs SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in your local .env.
async function run() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));

  const passwordHash = await bcrypt.hash(password, 10);
  await userModel.updateOne(
    { email: email.toLowerCase().trim() },
    {
      $set: {
        name: 'Administrator',
        passwordHash,
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    },
    { upsert: true },
  );

  console.log(`Admin account ready: ${email.toLowerCase().trim()}`);
  await app.close();
}

run().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});