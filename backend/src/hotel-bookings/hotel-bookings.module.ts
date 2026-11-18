import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { Room, RoomSchema } from '../hotels/schemas/room.schema';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { HotelAvailabilityService } from './hotel-availability.service';
import { HotelBookingJobs } from './hotel-booking.jobs';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelHoldService } from './hotel-hold.service';
import { HotelPaymentHandler } from './hotel-payment.handler';
import { HotelRoomsController } from './hotel-rooms.controller';
import { HotelRoomsService } from './hotel-rooms.service';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import {
  HotelBooking,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { RoomLock, RoomLockSchema } from './schemas/room-lock.schema';

// Memo's hotel side (HTL-11, HTL-12, HTL-15 to HTL-18): the RoomLock, Review
// and HotelBooking models, HotelAvailabilityService, the hotel search
// (GET /hotels/search), a hotel's free rooms (GET /hotels/:id/rooms/available)
// and reservations with their 10-minute hold (POST /hotel-bookings). The
// 'hotel' PaymentHandler is registered with PaymentsService at startup
// (PAY-01). Exported for Rawda (HTL-02, HTL-05, HTL-06, HTL-08), Moharm
// (ITN-25), Hasan (HTL-20 to HTL-24, ACC-17) and Hafez (GEN-09, GEN-10):
// import HotelBookingsModule and inject @InjectModel(HotelBooking.name) or
// @InjectModel(Review.name). It registers the Hotel and Room models itself
// instead of importing HotelsModule, so HotelsModule can import this module
// for blocking (HTL-06) without a circular import. Mongoose reuses the one
// Hotel and Room model either way.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomLock.name, schema: RoomLockSchema },
      { name: Review.name, schema: ReviewSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
    PaymentsModule,
  ],
  controllers: [
    HotelSearchController,
    HotelRoomsController,
    HotelBookingsController,
  ],
  providers: [
    HotelAvailabilityService,
    HotelSearchService,
    HotelRoomsService,
    HotelHoldService,
    HotelPaymentHandler,
    HotelBookingJobs,
  ],
  exports: [
    HotelAvailabilityService,
    HotelSearchService,
    HotelHoldService,
    MongooseModule,
  ],
})
export class HotelBookingsModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly handler: HotelPaymentHandler,
  ) {}

  onModuleInit(): void {
    this.payments.registerHandler(PaymentBookingType.HOTEL, this.handler);
  }
}
