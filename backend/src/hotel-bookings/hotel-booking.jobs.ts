import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';
import { HotelHoldService } from './hotel-hold.service';

// GEN-11 / HTL-18, every minute: PendingPayment reservations past expiresAt
// become Expired and their rooms are freed. It goes through
// PaymentsService.releaseInventory(), so PAY-01 can also cancel the
// PaymentIntent there (conventions.md, "Hold expiry"). Availability never
// depends on this job: an expired Held lock already counts as free.
@Injectable()
export class HotelBookingJobs {
  private readonly logger = new Logger(HotelBookingJobs.name);

  constructor(
    private readonly holds: HotelHoldService,
    private readonly payments: PaymentsService,
  ) {}

  // Returns how many reservations it expired. One failure never stops the
  // others.
  @Cron(CronExpression.EVERY_MINUTE)
  async expireHolds(now: Date = new Date()): Promise<number> {
    let ids: string[];
    try {
      ids = await this.holds.findExpiredHolds(now);
    } catch (err) {
      this.logger.error(`Hold expiry job failed: ${(err as Error).message}`);
      return 0;
    }
    let expired = 0;
    for (const id of ids) {
      try {
        await this.payments.releaseInventory(PaymentBookingType.HOTEL, id);
        expired++;
      } catch (err) {
        this.logger.error(
          `Could not expire reservation ${id}: ${(err as Error).message}`,
        );
      }
    }
    return expired;
  }
}
