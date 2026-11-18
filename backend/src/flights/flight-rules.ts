import { FilterQuery } from 'mongoose';
import { Cabin, Flight, FlightStatus } from './schemas/flight.schema';

// FLT-30, for Aabsy's search and holds and for the flight edit routes.
// A flight is bookable, searchable and editable only while it is Scheduled
// and has not departed yet. The departure time is checked too, so nothing
// depends on when the per-minute Departed job last ran.
export function isBookable(
  flight: Pick<Flight, 'status' | 'departureAt'>,
  now: Date = new Date(),
): boolean {
  return (
    flight.status === FlightStatus.SCHEDULED &&
    new Date(flight.departureAt).getTime() > now.getTime()
  );
}

// The same rule as a query filter:
//   this.flights.find({ ...bookableFilter(), from, to })
export function bookableFilter(now: Date = new Date()): FilterQuery<Flight> {
  return { status: FlightStatus.SCHEDULED, departureAt: { $gt: now } };
}

// The status to show: a Scheduled flight whose departure has passed is
// Departed even if the job has not updated it yet.
export function effectiveStatus(
  flight: Pick<Flight, 'status' | 'departureAt'>,
  now: Date = new Date(),
): FlightStatus {
  if (
    flight.status === FlightStatus.SCHEDULED &&
    new Date(flight.departureAt).getTime() <= now.getTime()
  ) {
    return FlightStatus.DEPARTED;
  }
  return flight.status;
}

// FLT-04: seats that can still be held or booked.
export function availableSeats(
  cabin: Pick<Cabin, 'totalSeats' | 'bookedSeats' | 'heldSeats'>,
): number {
  return Math.max(
    0,
    cabin.totalSeats - (cabin.bookedSeats ?? 0) - (cabin.heldSeats ?? 0),
  );
}
