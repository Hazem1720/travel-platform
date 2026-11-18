import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { ReorderDayDto } from './dto/day.dto';
import {
  ITN_ID,
  OWNER,
  day,
  itinerary,
  makeDaysService,
} from './itinerary.fixtures-spec';

// ITN-08: move a day; numbers and dates follow the new order.
describe('DaysService.reorderDay (ITN-08)', () => {
  const setup = () => {
    const days = [day('cairo'), day('cairo'), day('luxor')];
    const doc = { ...itinerary(days), updatedAt: new Date('2026-11-17') };
    return { days, ...makeDaysService(doc) };
  };

  it('moves day 3 to position 1 and renumbers and re-dates', async () => {
    const { service, days } = setup();
    const result = await service.reorderDay(OWNER, ITN_ID, {
      dayId: String(days[2]._id),
      newPosition: 1,
    });
    expect(
      result.days.map((d) => [d.number, d.cityId, d.date.toISOString()]),
    ).toEqual([
      [1, 'luxor', '2026-12-01T00:00:00.000Z'],
      [2, 'cairo', '2026-12-02T00:00:00.000Z'],
      [3, 'cairo', '2026-12-03T00:00:00.000Z'],
    ]);
    expect(String(result.days[0]._id)).toBe(String(days[2]._id));
  });

  it('refuses a position beyond the last day (400)', async () => {
    const { service, days } = setup();
    await expect(
      service.reorderDay(OWNER, ITN_ID, {
        dayId: String(days[0]._id),
        newPosition: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses position 0 (400)', async () => {
    const errors = await validate(
      plainToInstance(ReorderDayDto, {
        dayId: String(new Types.ObjectId()),
        newPosition: 0,
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(['newPosition']);
  });

  it('answers 404 for an unknown day', async () => {
    const { service } = setup();
    await expect(
      service.reorderDay(OWNER, ITN_ID, {
        dayId: String(new Types.ObjectId()),
        newPosition: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 409 if the itinerary changed in between', async () => {
    const { service, days, model } = setup();
    model.findOneAndUpdate.mockImplementationOnce(() => ({
      lean: async () => null,
    }));
    await expect(
      service.reorderDay(OWNER, ITN_ID, {
        dayId: String(days[0]._id),
        newPosition: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
