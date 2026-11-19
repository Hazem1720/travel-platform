import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { FavouritesController } from './favourites.controller';
import { FavouritesService } from './favourites.service';
import { Favourite, FavouriteSchema } from './schemas/favourite.schema';

// BON-02 (Memo). Its own module, so it changes nobody else's code: it only
// reads hotels and uses Moharm's exported PublicItinerariesService.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Favourite.name, schema: FavouriteSchema },
      { name: Hotel.name, schema: HotelSchema },
    ]),
    ItinerariesModule,
  ],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
