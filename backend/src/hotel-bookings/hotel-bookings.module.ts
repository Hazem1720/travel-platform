import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { Room, RoomSchema } from '../hotels/schemas/room.schema';
import { HotelAvailabilityService } from './hotel-availability.service';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { Review, ReviewSchema } from './schemas/review.schema';
import { RoomLock, RoomLockSchema } from './schemas/room-lock.schema';

// Memo's hotel side (HTL-11, HTL-12, HTL-15 to HTL-18). For now: the RoomLock
// and Review models, HotelAvailabilityService and the hotel search
// (HotelSearchService, GET /hotels/search), exported for Rawda (HTL-02,
// HTL-05, HTL-06, HTL-08), Moharm (ITN-25), Hasan (HTL-23, HTL-24) and Hafez
// (GEN-09, GEN-10): import HotelBookingsModule and inject
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
    ]),
  ],
  controllers: [HotelSearchController],
  providers: [HotelAvailabilityService, HotelSearchService],
  exports: [HotelAvailabilityService, HotelSearchService, MongooseModule],
})
export class HotelBookingsModule {}
