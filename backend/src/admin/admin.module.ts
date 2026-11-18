import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

// The admin area. One controller per owner, all under /admin and all
// @Roles(Role.ADMIN):
// - Memo: admin-accounts.controller.ts (ACC-14 account list; ACC-07a next)
// - Hazem: add your own controller here for ACC-13 (moderators) and
//   ACC-15, ACC-16 (suspend and reactivate)
// - Hasan: add your own controller here for ACC-17 (all bookings)
// The audit log (GEN-07) stays in src/audit. Import other modules here as
// your routes need them (for example AirlinesModule, HotelsModule).
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AdminAccountsController],
  providers: [AdminAccountsService],
  exports: [AdminAccountsService],
})
export class AdminModule {}
