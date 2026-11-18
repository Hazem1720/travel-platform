import { Module } from '@nestjs/common';
import { AirlinesModule } from '../airlines/airlines.module';
import { HotelsModule } from '../hotels/hotels.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

// Hazem's part of src/admin: ACC-13, ACC-15, ACC-16. Its own module, so it
// does not clash with Memo's admin module (ACC-14, ACC-07a); both share the
// admin/ route prefix. The User model comes from the global AuthModule,
// AuditService and NotificationsService are global too.
@Module({
  imports: [AirlinesModule, HotelsModule],
  controllers: [AdminAccountsController],
  providers: [AdminAccountsService],
})
export class AdminAccountsModule {}
