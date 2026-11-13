import { Module } from '@nestjs/common';
import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';

// FLT-02. The Airport, City and Country models come from the global
// ReferenceModule. Other modules import AirportsModule to call
// AirportsService.assertAirportExists(code) (FLT-03, FLT-11).
@Module({
  controllers: [AirportsController],
  providers: [AirportsService],
  exports: [AirportsService],
})
export class AirportsModule {}
