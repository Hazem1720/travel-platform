import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Room, RoomSchema } from './schemas/room.schema';

// HTL-01 to HTL-10. Exports the services and the Hotel and Room models
// (MongooseModule), so Hazem (ACC-13, ACC-15), Memo (HTL-11, HTL-16) and
// Moharm (ITN-25) can use them by importing HotelsModule. City comes from
// the global ReferenceModule.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
  ],
  controllers: [HotelsController, RoomsController],
  providers: [HotelsService, RoomsService],
  exports: [HotelsService, RoomsService, MongooseModule],
})
export class HotelsModule {}
