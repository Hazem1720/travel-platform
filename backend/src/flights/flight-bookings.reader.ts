import { Types } from 'mongoose';

// What FLT-05 needs from the flight bookings (Aabsy's FLT-22/FLT-23), as a
// small contract so this module does not import his. His module provides it
// under this token from a @Global() module:
//   { provide: FLIGHT_BOOKINGS_READER, useExisting: FlightBookingsService }
// Until it is provided, FlightsService falls back to the seat counters
// (booked or held seats mean the flight has bookings) and there are no
// Confirmed passengers to notify.
export const FLIGHT_BOOKINGS_READER = Symbol('FLIGHT_BOOKINGS_READER');

export interface FlightBookingsReader {
  // Any booking on this flight, in any status.
  hasBookings(flightId: Types.ObjectId | string): Promise<boolean>;
  // The users with a Confirmed booking on this flight (each once).
  confirmedUserIds(
    flightId: Types.ObjectId | string,
  ): Promise<Array<Types.ObjectId | string>>;
}
