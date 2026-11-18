import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminAccountsModule } from './admin/admin-accounts.module';
import { AdminModule } from './admin/admin.module';
import { AirlinesModule } from './airlines/airlines.module';
import { AirportsModule } from './airports/airports.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { FlightsModule } from './flights/flights.module';
import { HotelBookingsModule } from './hotel-bookings/hotel-bookings.module';
import { HotelsModule } from './hotels/hotels.module';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { ReferenceModule } from './reference/reference.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    ReferenceModule,
    AirlinesModule,
    AirportsModule,
    FlightsModule,
    UploadsModule,
    NotificationsModule,
    AuditModule,
    // Before HotelsModule: GET /hotels/search (HTL-11) must be registered
    // before GET /hotels/:id.
    HotelBookingsModule,
    HotelsModule,
    PaymentsModule,
    ItinerariesModule,
    AdminAccountsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
