import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from '../auth/dto/register.dto';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { User, UserDocument } from '../users/schemas/user.schema';

// ACC-18: admin accounts are created only by this seed, never by registration.
// Needs SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env.
//
//   npm run seed:admin                      create the admin if it does not exist
//   npm run seed:admin -- --reset-password  also reset an existing admin's password
async function run() {
  const resetPassword = process.argv.includes('--reset-password');

  // Create the context first: ConfigModule is what loads backend/.env.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const config = app.get(ConfigService);
    const email = config.get<string>('SEED_ADMIN_EMAIL')?.toLowerCase().trim();
    const password = config.get<string>('SEED_ADMIN_PASSWORD');
    if (!email || !password) {
      throw new Error(
        'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env',
      );
    }
    // ACC-01: the admin password follows the same rule as every other account.
    if (!PASSWORD_REGEX.test(password)) {
      throw new Error(`SEED_ADMIN_PASSWORD is too weak. ${PASSWORD_MESSAGE}`);
    }

    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const passwordHash = await bcrypt.hash(password, 10);
    const credentials = {
      passwordHash,
      failedLoginAttempts: 0,
      lockUntil: null,
    };

    const res = await userModel.updateOne(
      { email },
      {
        $set: {
          name: 'Administrator',
          role: Role.ADMIN,
          status: AccountStatus.ACTIVE,
          ...(resetPassword ? credentials : {}),
        },
        // Runs only when the admin does not exist yet, so a re-run never
        // silently overwrites a password that was changed after seeding.
        ...(resetPassword ? {} : { $setOnInsert: credentials }),
      },
      { upsert: true },
    );

    if (res.upsertedCount) console.log(`Admin account created: ${email}`);
    else if (resetPassword) console.log(`Admin password reset: ${email}`);
    else
      console.log(`Admin account already exists, password unchanged: ${email}`);
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
