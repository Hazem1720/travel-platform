import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from '../hotels/schemas/room.schema';
import { HotelAvailabilityService } from './hotel-availability.service';
import { RoomLock, RoomLockSchema } from './schemas/room-lock.schema';

// Memo's hotel side (HTL-11, HTL-12, HTL-15 to HTL-18). For now: the RoomLock
// model and HotelAvailabilityService, exported for Rawda (HTL-02, HTL-05,
// HTL-06, HTL-08) and Moharm (ITN-25). It registers the Room model itself
// instead of importing HotelsModule, so HotelsModule can import this module
// for blocking (HTL-06) without a circular import. Mongoose reuses the one
// Room model either way.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: RoomLock.name, schema: RoomLockSchema },
    ]),
  ],
  providers: [HotelAvailabilityService],
  exports: [HotelAvailabilityService, MongooseModule],
})
export class HotelBookingsModule {}
