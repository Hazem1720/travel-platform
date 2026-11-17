import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';

// ITN-01 validation, as the global ValidationPipe runs it.
async function errorsFor(cls: any, body: object) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('Itinerary DTOs (ITN-01)', () => {
  const valid = {
    title: 'TEST Egypt',
    countries: ['eg'],
    startDate: '2026-12-01',
  };

  it('accepts a valid itinerary and upper-cases country codes', async () => {
    expect(await errorsFor(CreateItineraryDto, valid)).toEqual([]);
    const dto = plainToInstance(CreateItineraryDto, valid);
    expect(dto.countries).toEqual(['EG']);
  });

  it('accepts a title of exactly 100 characters', async () => {
    expect(
      await errorsFor(CreateItineraryDto, { ...valid, title: 'a'.repeat(100) }),
    ).toEqual([]);
  });

  it('rejects a title of 101 characters (400)', async () => {
    expect(
      await errorsFor(CreateItineraryDto, { ...valid, title: 'a'.repeat(101) }),
    ).toEqual(['title']);
  });

  it('rejects a missing or blank title (400)', async () => {
    expect(
      await errorsFor(CreateItineraryDto, { ...valid, title: undefined }),
    ).toEqual(['title']);
    expect(
      await errorsFor(CreateItineraryDto, { ...valid, title: '   ' }),
    ).toEqual(['title']);
  });

  it('rejects countries [] (400)', async () => {
    expect(
      await errorsFor(CreateItineraryDto, { ...valid, countries: [] }),
    ).toEqual(['countries']);
  });

  it('rejects a missing or impossible start date (400)', async () => {
    expect(
      await errorsFor(CreateItineraryDto, { ...valid, startDate: undefined }),
    ).toEqual(['startDate']);
    expect(
      await errorsFor(CreateItineraryDto, {
        ...valid,
        startDate: '2026-02-30',
      }),
    ).toEqual(['startDate']);
  });

  it('rejects fields a client may not set, such as visibility or ownerId', async () => {
    expect(
      await errorsFor(CreateItineraryDto, {
        ...valid,
        visibility: 'Public',
        ownerId: 'x',
      }),
    ).toEqual(['visibility', 'ownerId']);
  });

  it('lets an edit change one field at a time', async () => {
    expect(await errorsFor(UpdateItineraryDto, { title: 'TEST New' })).toEqual(
      [],
    );
    expect(await errorsFor(UpdateItineraryDto, { countries: [] })).toEqual([
      'countries',
    ]);
  });
});
