import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { EmailService } from './email.service';

// GEN-01-B (Memo, bonus). Global like NotificationsModule, so
// NotificationsService and the moderator creation (ACC-13) can use it
// without importing it.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
