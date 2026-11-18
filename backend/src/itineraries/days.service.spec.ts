import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
  makeDaysService,
} from './itinerary.fixtures-spec';
import { presentItinerary } from './itinerary.view';

describe('DaysService (ITN-05)', () => {
  it('numbers 3 added days 1 to 3 with consecutive dates', async () => {
    const { service } = makeDaysService(itinerary());
    await service.addDay(OWNER, ITN_ID, { cityId: 'cairo' });
    await service.addDay(OWNER, ITN_ID, { cityId: 'cairo', notes: 'Museum' });
    const result = await service.addDay(OWNER, ITN_ID, { cityId: 'luxor' });
    expect(
      result.days.map((d) => [d.number, d.date.toISOString(), d.cityId]),
    ).toEqual([
      [1, '2026-12-01T00:00:00.000Z', 'cairo'],
      [2, '2026-12-02T00:00:00.000Z', 'cairo'],
      [3, '2026-12-03T00:00:00.000Z', 'luxor'],
    ]);
  });

  it('shifts every date when the start date changes', () => {
    const days = [day('cairo'), day('luxor')];
    const moved = presentItinerary(itinerary(days, '2027-01-30'));
    expect(moved.days.map((d) => d.date.toISOString())).toEqual([
      '2027-01-30T00:00:00.000Z',
      '2027-01-31T00:00:00.000Z',
    ]);
  });

  it('refuses a 61st day (400)', async () => {
    const days = Array.from({ length: 60 }, () => day('cairo'));
    const { service, model } = makeDaysService(itinerary(days));
    await expect(
      service.addDay(OWNER, ITN_ID, { cityId: 'cairo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses the 60th-day race in the update filter itself', async () => {
    const days = Array.from({ length: 59 }, () => day('cairo'));
    const { service, model } = makeDaysService(itinerary(days));
    await service.addDay(OWNER, ITN_ID, { cityId: 'cairo' });
    expect(model.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      'days.59': { $exists: false },
    });
  });

  it('refuses an unknown city (400)', async () => {
    const { service } = makeDaysService(itinerary());
    await expect(
      service.addDay(OWNER, ITN_ID, { cityId: 'atlantis' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("edits a day's city and notes", async () => {
    const d = day('cairo');
    const { service } = makeDaysService(itinerary([d]));
    const result = await service.updateDay(OWNER, ITN_ID, String(d._id), {
      cityId: 'luxor',
      notes: 'Valley of the Kings',
    });
    expect(result.days[0]).toMatchObject({
      cityId: 'luxor',
      notes: 'Valley of the Kings',
      number: 1,
    });
  });

  it('answers 404 for an unknown day or another user', async () => {
    const d = day('cairo');
    const { service } = makeDaysService(itinerary([d]));
    await expect(
      service.updateDay(OWNER, ITN_ID, String(new Types.ObjectId()), {
        notes: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.addDay(STRANGER, ITN_ID, { cityId: 'cairo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
