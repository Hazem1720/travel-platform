import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';

// FLT-09, HTL-10: cancellation tiers shared by airlines and hotels.
// Used by Hazem (FLT-09), Rawda (HTL-10), Memo (HTL-21, PAY-03) and
// Aabsy (FLT-26). Stored as cancellationTiers[{ daysBefore, refundPercent }]
// (conventions.md, "Providers").

export interface CancellationTierLike {
  daysBefore: number;
  refundPercent: number;
}

// One tier in a request body.
export class CancellationTierDto implements CancellationTierLike {
  @ApiProperty({
    example: 7,
    minimum: 0,
    description: 'Days before departure or check-in (whole number, >= 0)',
  })
  @IsInt()
  @Min(0)
  daysBefore: number;

  @ApiProperty({ example: 50, minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercent: number;
}

// Rejects two tiers with the same daysBefore (400 through the global pipe).
export function UniqueDaysBefore(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'uniqueDaysBefore',
      validator: {
        validate: (value: unknown) =>
          !Array.isArray(value) || hasUniqueThresholds(value),
        defaultMessage: () => 'Each tier must have a different daysBefore',
      },
    },
    options,
  );
}

// Request body for PUT /airlines/:id/cancellation-policy and the hotel
// equivalent: { tiers: [{ daysBefore, refundPercent }] }. An empty list is
// allowed: then every cancellation refunds 0%.
export class CancellationPolicyDto {
  @ApiProperty({
    type: [CancellationTierDto],
    example: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  @UniqueDaysBefore()
  tiers: CancellationTierDto[];
}

// Embedded sub-document for the Airline and Hotel schemas:
//   @Prop({ type: [CancellationTierSchema], default: [] })
//   cancellationTiers: CancellationTier[];
@Schema({ _id: false })
export class CancellationTier implements CancellationTierLike {
  @Prop({ required: true, min: 0 })
  daysBefore: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercent: number;
}
export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

export function hasUniqueThresholds(tiers: CancellationTierLike[]): boolean {
  const seen = new Set(tiers.map((t) => t?.daysBefore));
  return seen.size === tiers.length;
}

// The refund percentage for a cancellation made `daysRemaining` days before
// departure or check-in: the tier with the highest daysBefore that is not
// above daysRemaining; 0 if no tier applies (FLT-09).
// Example, tiers { 30: 100, 7: 50, 0: 0 }: 45 -> 100, 30 -> 100, 10 -> 50, 3 -> 0.
// Count daysRemaining in the airport's or hotel's local date (see
// time-zone.ts, localDaysUntil).
export function refundPercent(
  tiers: CancellationTierLike[] | null | undefined,
  daysRemaining: number,
): number {
  let best: CancellationTierLike | undefined;
  for (const tier of tiers ?? []) {
    if (tier.daysBefore > daysRemaining) continue;
    if (!best || tier.daysBefore > best.daysBefore) best = tier;
  }
  return best ? best.refundPercent : 0;
}

// Refund in integer cents for a total in cents, rounded to the nearest cent.
export function refundAmount(
  totalCents: number,
  tiers: CancellationTierLike[] | null | undefined,
  daysRemaining: number,
): number {
  return Math.round((totalCents * refundPercent(tiers, daysRemaining)) / 100);
}
