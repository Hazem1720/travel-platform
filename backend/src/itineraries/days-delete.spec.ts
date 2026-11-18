import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
  makeDaysService,
} from './itinerary.fixtures-spec';

// ITN-07: delete a day; the rest are renumbered and re-dated.
describe('DaysService.removeDay (ITN-07)', () => {
  it('deleting day 2 of 3 leaves days 1 and 2 with recomputed dates', async () => {
    const days = [day('cairo'), day('luxor'), day('aswan')];
    const { service } = makeDaysService(itinerary(days));
    const result = await service.removeDay(OWNER, ITN_ID, String(days[1]._id));
    expect(
      result.days.map((d) => [d.number, d.cityId, d.date.toISOString()]),
    ).toEqual([
      [1, 'cairo', '2026-12-01T00:00:00.000Z'],
      [2, 'aswan', '2026-12-02T00:00:00.000Z'],
    ]);
  });

  it('answers 404 for an unknown day or another user', async () => {
    const days = [day('cairo')];
    const { service } = makeDaysService(itinerary(days));
    await expect(
      service.removeDay(OWNER, ITN_ID, String(new Types.ObjectId())),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.removeDay(STRANGER, ITN_ID, String(days[0]._id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
