import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { DaysService } from './days.service';
import { CreateTransportCostDto } from './dto/transport-cost.dto';
import { ItinerariesService } from './itineraries.service';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
  makeDaysService,
} from './itinerary.fixtures-spec';
import { TransportMode } from './schemas/itinerary.schema';
import { TransportCostsService } from './transport-costs.service';

// ITN-16: intercity transport costs on a day of the itinerary.
describe('TransportCostsService (ITN-16)', () => {
  function setup() {
    const days = [day('cairo'), day('cairo'), day('luxor')];
    const entry = {
      _id: new Types.ObjectId(),
      mode: TransportMode.TRAIN,
      fromCityId: 'cairo',
      toCityId: 'luxor',
      amount: 900,
      currency: 'EGP',
      dayId: days[2]._id,
    };
    const doc = { ...itinerary(days), transportCosts: [entry] };
    const itineraries = {
      findById: jest.fn(() => ({ lean: async () => doc })),
      findOne: jest.fn(() => ({ lean: async () => doc })),
      findOneAndUpdate: jest.fn<any, [any, any, any]>((_f, update) => ({
        lean: async () => {
          for (const [k, v] of Object.entries(update.$set ?? {})) {
            (entry as any)[k.split('.').pop() as string] = v;
          }
          return doc;
        },
      })),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const cities = {
      exists: jest.fn(async (q: { _id: string }) =>
        ['cairo', 'luxor'].includes(q._id) ? q : null,
      ),
    };
    const itinerariesService = new ItinerariesService(
      itineraries as any,
      {} as any,
    );
    const daysService = new DaysService(
      itineraries as any,
      cities as any,
      itinerariesService,
    );
    const service = new TransportCostsService(
      itineraries as any,
      itinerariesService,
      daysService,
    );
    return { service, itineraries, days, entry };
  }

  const dto = (dayId: string) => ({
    mode: TransportMode.TRAIN,
    fromCityId: 'cairo',
    toCityId: 'luxor',
    amount: 900,
    currency: 'EGP',
    dayId,
  });

  it('adds a Cairo to Luxor train on day 3', async () => {
    const { service, itineraries, days } = setup();
    const created = await service.add(OWNER, ITN_ID, dto(String(days[2]._id)));
    expect(created).toMatchObject({
      mode: 'train',
      fromCityId: 'cairo',
      toCityId: 'luxor',
      amount: 900,
      dayId: days[2]._id,
    });
    expect(
      itineraries.findOneAndUpdate.mock.calls[0][1].$push.transportCosts,
    ).toMatchObject({ amount: 900, currency: 'EGP' });
  });

  it('refuses an unknown city (400)', async () => {
    const { service, days } = setup();
    await expect(
      service.add(OWNER, ITN_ID, {
        ...dto(String(days[0]._id)),
        toCityId: 'atlantis',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a day of another itinerary (400)', async () => {
    const { service } = setup();
    await expect(
      service.add(OWNER, ITN_ID, dto(String(new Types.ObjectId()))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('edits and deletes an entry; others get 404', async () => {
    const { service, itineraries, entry } = setup();
    const updated = await service.update(OWNER, String(entry._id), {
      amount: 750,
    });
    expect(updated.amount).toBe(750);
    await expect(
      service.remove(STRANGER, String(entry._id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.remove(OWNER, String(entry._id));
    expect(itineraries.updateOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a negative amount or unsupported currency (400)', async () => {
    const errors = await validate(
      plainToInstance(CreateTransportCostDto, {
        ...dto(String(new Types.ObjectId())),
        amount: -5,
        currency: 'ABC',
      }),
    );
    expect(errors.map((e) => e.property).sort()).toEqual([
      'amount',
      'currency',
    ]);
  });

  it("deleting a day also deletes that day's transport costs (ITN-07)", async () => {
    const days = [day('cairo')];
    const { service, model } = makeDaysService(itinerary(days));
    await service.removeDay(OWNER, ITN_ID, String(days[0]._id));
    expect(model.findOneAndUpdate.mock.calls[0][1].$pull).toEqual({
      days: { _id: days[0]._id },
      transportCosts: { dayId: days[0]._id },
      // ITN-27: links to the day go with it.
      linkedBookings: { dayId: days[0]._id },
    });
  });
});
