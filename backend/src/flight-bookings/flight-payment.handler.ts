import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  Cabin,
  Flight,
  FlightDocument,
} from '../flights/schemas/flight.schema';
import {
  BookingPolicies,
  PayableBooking,
  PaymentHandler,
} from '../payments/payment-handler';
import { FlightConfirmationService } from './flight-confirmation.service';
import { FlightHoldService, LeanFlightBooking } from './flight-hold.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

// PAY-01 contract: what Memo's PaymentsService needs from flight bookings.
// Registered as the 'flight' handler in FlightBookingsModule.onModuleInit().
// getPolicies and acceptPolicies (PAY-02) were added by Memo.
@Injectable()
export class FlightPaymentHandler implements PaymentHandler {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    private readonly holds: FlightHoldService,
    private readonly confirmations: FlightConfirmationService,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
  ) {}

  // Payments does the checks (owner, PendingPayment, hold, policies).
  async getPayable(bookingId: string): Promise<PayableBooking | null> {
    if (!isValidObjectId(bookingId)) return null;
    const b = await this.bookings.findById(bookingId).lean<LeanFlightBooking>();
    if (!b) return null;
    return {
      bookingId: String(b._id),
      userId: String(b.userId),
      status: b.status,
      amount: b.totalAmount,
      currency: b.currency,
      expiresAt: b.expiresAt ?? null,
      policiesAcceptedAt: b.policiesAcceptedAt ?? null,
      description: `Flight ${b.segments
        .map((s) => `${s.flightNumber} ${s.from}-${s.to}`)
        .join(', ')}`,
    };
  }

  // FLT-23: after Stripe's webhook verified the payment. Safe to call twice;
  // 409 if the booking is no longer PendingPayment (Payments refunds it).
  confirm(bookingId: string): Promise<void> {
    return this.confirmations.confirm(bookingId);
  }

  // The hold ran out: Expired and the seats released (FLT-22).
  expire(bookingId: string): Promise<void> {
    return this.holds.expire(bookingId);
  }

  // PAY-02: the airline's cancellation tiers (FLT-09) and baggage policy
  // (FLT-04, FLT-08) as they are now. A round trip is cancelled as a whole
  // with the outbound segment's tiers (FLT-12a), so the outbound airline is
  // the provider, and its tiers and extra-bag price are shown. Each booked
  // cabin shows its own free bags and weight. Payments checks the owner.
  async getPolicies(bookingId: string): Promise<BookingPolicies | null> {
    if (!isValidObjectId(bookingId)) return null;
    const b = await this.bookings.findById(bookingId).lean<LeanFlightBooking>();
    if (!b) return null;

    const outbound = b.segments[0];
    const [airline, flights] = await Promise.all([
      this.airlines
        .findById(outbound.airlineId, {
          name: 1,
          cancellationTiers: 1,
          extraBagPrice: 1,
          maxExtraBags: 1,
        })
        .lean<Airline & { _id: Types.ObjectId }>(),
      this.flights
        .find(
          { _id: { $in: b.segments.map((s) => s.flightId) } },
          { cabins: 1 },
        )
        .lean<{ _id: Types.ObjectId; cabins: Cabin[] }[]>(),
    ]);
    const cabinOf = (flightId: Types.ObjectId, cabinId: Types.ObjectId) =>
      flights
        .find((f) => String(f._id) === String(flightId))
        ?.cabins.find((c) => String(c._id) === String(cabinId));

    return {
      bookingId: String(b._id),
      userId: String(b.userId),
      status: b.status,
      expiresAt: b.expiresAt ?? null,
      policiesAcceptedAt: b.policiesAcceptedAt ?? null,
      provider: {
        id: String(outbound.airlineId),
        name: airline?.name ?? outbound.flightNumber,
      },
      cancellationTiers: [...(airline?.cancellationTiers ?? [])]
        .map(({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }))
        .sort((x, y) => y.daysBefore - x.daysBefore),
      baggage: {
        extraBagPrice: airline?.extraBagPrice ?? null,
        maxExtraBags: airline?.maxExtraBags ?? 0,
        cabins: b.segments.map((s) => {
          const cabin = cabinOf(s.flightId, s.cabinId);
          return {
            flightNumber: s.flightNumber,
            cabin: s.cabin,
            freeBags: cabin?.freeBags ?? 0,
            maxKgPerBag: cabin?.maxKgPerBag ?? 0,
          };
        }),
      },
    };
  }

  // PAY-02: stores the acceptance time once, only while the booking is
  // PendingPayment and its hold has not run out. False if that no longer
  // holds (Payments answers 409).
  async acceptPolicies(bookingId: string, at: Date): Promise<boolean> {
    if (!isValidObjectId(bookingId)) return false;
    const res = await this.bookings.updateOne(
      {
        _id: bookingId,
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: { $gt: at },
        policiesAcceptedAt: null,
      },
      { $set: { policiesAcceptedAt: at } },
    );
    return res.modifiedCount === 1;
  }
}
