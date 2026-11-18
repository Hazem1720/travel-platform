import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AvailabilityRangeDto } from './dto/availability-range.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { isDateOnly } from './dto/date-only';
import { HotelPoliciesDto } from './dto/policies.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';

const errorsOf = async (cls: any, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('hotel DTOs', () => {
  const hotel = {
    name: 'TEST Nile View',
    address: '12 Corniche',
    cityId: 'cairo',
    countryCode: 'EG',
    starClass: 4,
  };

  describe('CreateHotelDto (HTL-01)', () => {
    it('accepts a valid hotel and normalises the ids', async () => {
      const dto = plainToInstance(CreateHotelDto, {
        ...hotel,
        cityId: ' Cairo ',
        countryCode: ' eg ',
      });
      expect(dto).toMatchObject({ cityId: 'cairo', countryCode: 'EG' });
      expect(await validate(dto)).toEqual([]);
    });

    it.each([0, 6, 3.5])('rejects starClass %p', async (starClass) => {
      expect(await errorsOf(CreateHotelDto, { ...hotel, starClass })).toEqual([
        'starClass',
      ]);
    });

    it('requires name, address, city and country', async () => {
      expect(await errorsOf(CreateHotelDto, { starClass: 3 })).toEqual(
        expect.arrayContaining(['name', 'address', 'cityId', 'countryCode']),
      );
    });

    it('allows a partial update', async () => {
      expect(await errorsOf(UpdateHotelDto, { description: 'x' })).toEqual([]);
      expect(await errorsOf(UpdateHotelDto, {})).toEqual([]);
    });
  });

  describe('CreateRoomDto (HTL-03)', () => {
    const room = {
      name: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 2,
      pricePerNight: 100,
    };

    it('accepts a valid room', async () => {
      expect(await errorsOf(CreateRoomDto, room)).toEqual([]);
    });

    it('rejects maxOccupancy 0 and price 0 (400)', async () => {
      expect(
        await errorsOf(CreateRoomDto, { ...room, maxOccupancy: 0 }),
      ).toEqual(['maxOccupancy']);
      expect(
        await errorsOf(CreateRoomDto, { ...room, pricePerNight: 0 }),
      ).toEqual(['pricePerNight']);
    });

    it('rejects a fractional price (prices are whole cents)', async () => {
      expect(
        await errorsOf(CreateRoomDto, { ...room, pricePerNight: 10.5 }),
      ).toEqual(['pricePerNight']);
    });
  });

  describe('HotelPoliciesDto (HTL-09, HTL-10)', () => {
    const policies = {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 0, refundPercent: 0 },
      ],
    };

    it('accepts valid times and tiers', async () => {
      expect(await errorsOf(HotelPoliciesDto, policies)).toEqual([]);
    });

    it.each(['25:00', '24:00', '9:00', '14:60', 'noon'])(
      'rejects the time %p',
      async (checkInTime) => {
        expect(
          await errorsOf(HotelPoliciesDto, { ...policies, checkInTime }),
        ).toEqual(['checkInTime']);
      },
    );

    it('rejects a duplicate daysBefore', async () => {
      const cancellationTiers = [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
      ];
      expect(
        await errorsOf(HotelPoliciesDto, { ...policies, cancellationTiers }),
      ).toEqual(['cancellationTiers']);
    });

    it('rejects a refund of 101%', async () => {
      const cancellationTiers = [{ daysBefore: 7, refundPercent: 101 }];
      const errors = await validate(
        plainToInstance(HotelPoliciesDto, { ...policies, cancellationTiers }),
      );
      expect(errors.map((e) => e.property)).toEqual(['cancellationTiers']);
    });
  });

  describe('AvailabilityRangeDto (HTL-04)', () => {
    it('accepts real dates', async () => {
      expect(
        await errorsOf(AvailabilityRangeDto, {
          from: '2026-12-01',
          to: '2027-01-01',
        }),
      ).toEqual([]);
    });

    it.each(['2026-02-30', '2026-13-01', '1 Dec 2026', '2026-12-1', ''])(
      'rejects the date %p',
      async (from) => {
        expect(
          await errorsOf(AvailabilityRangeDto, { from, to: '2027-01-01' }),
        ).toEqual(['from']);
      },
    );

    it('knows leap days', () => {
      expect(isDateOnly('2028-02-29')).toBe(true);
      expect(isDateOnly('2027-02-29')).toBe(false);
    });
  });
});
