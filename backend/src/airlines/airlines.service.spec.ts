import { NotFoundException } from '@nestjs/common';
import { AirlinesService } from './airlines.service';

// FLT-01: airline profile. Duplicate codes are rejected by the unique index
// (409 through AllExceptionsFilter), so they are tested in Swagger.
describe('AirlinesService', () => {
  const ID = '6735a1f4c1a2b3c4d5e6f701';
  const airline = { _id: ID, name: 'TEST Nile Air', code: 'NP' };

  function setup(found: unknown = airline) {
    const model = {
      create: jest.fn(async (doc: object) => ({
        toObject: () => ({ _id: ID, isActive: true, ...doc }),
      })),
      findById: jest.fn(() => ({ lean: async () => found })),
      findByIdAndUpdate: jest.fn<any, [string, object, object]>(() => ({
        lean: async () => found,
      })),
    };
    return { service: new AirlinesService(model as any), model };
  }

  it('creates an airline and returns a plain object', async () => {
    const { service, model } = setup();
    const created = await service.create({ name: 'TEST Nile Air', code: 'NP' });
    expect(model.create).toHaveBeenCalledWith({
      name: 'TEST Nile Air',
      code: 'NP',
    });
    expect(created).toMatchObject({ _id: ID, code: 'NP', isActive: true });
  });

  it('returns an airline by id', async () => {
    const { service } = setup();
    await expect(service.get(ID)).resolves.toEqual(airline);
  });

  it('answers 404 for an unknown airline', async () => {
    const { service } = setup(null);
    await expect(service.get(ID)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(ID, { name: 'X' })).rejects.toThrow(
      'Airline not found',
    );
  });

  it('updates only the given fields, with schema validation', async () => {
    const { service, model } = setup();
    await service.update(ID, { name: 'TEST Nile Air Express' });
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      ID,
      { $set: { name: 'TEST Nile Air Express' } },
      { new: true, runValidators: true },
    );
  });
});
