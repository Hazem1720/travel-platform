import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { HotelBookingsModule } from './hotel-bookings.module';
import { HotelReservationsController } from './hotel-reservations.controller';
import { HotelReservationsService } from './hotel-reservations.service';

// Hasan's HTL-22: a hotel's reservations for its moderator. Its own module so
// it stays out of Memo's HotelBookingsModule; it reads the HotelBooking and
// Hotel models that module exports, and the User model for the guest's name.
@Module({
  imports: [
    HotelBookingsModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [HotelReservationsController],
  providers: [HotelReservationsService],
})
export class HotelReservationsModule {}
