import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AccountListController } from './account-list.controller';
import { AccountListService } from './account-list.service';
import { AccountPasswordService } from './account-password.service';

// Memo's part of src/admin: ACC-14 (GET /admin/accounts) and ACC-07a
// (POST /admin/accounts/:id/reset-password).
// Every route is @Roles(Role.ADMIN). The admin area is split by owner, each
// with its own module and files, all sharing the admin/ route prefix:
// - this module: account-list.controller.ts (Memo)
// - admin-accounts.module.ts: moderators, suspensions and provider
//   deactivation (Hazem, ACC-13, ACC-15, ACC-16)
// - Hasan: his own module or controller for ACC-17 (all bookings)
// The audit log (GEN-07) stays in src/audit.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AccountListController],
  providers: [AccountListService, AccountPasswordService],
  exports: [AccountListService],
})
export class AdminModule {}
