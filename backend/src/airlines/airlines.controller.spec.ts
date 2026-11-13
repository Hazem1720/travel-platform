import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { AirlinesController } from './airlines.controller';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

// FLT-01: only the airline's own moderator edits it.
describe('AirlinesController', () => {
  const MINE = '6735a1f4c1a2b3c4d5e6f701';
  const OTHER = '6735a1f4c1a2b3c4d5e6f702';
  const moderator: AuthUser = {
    id: 'u1',
    role: Role.AIRLINE_MODERATOR,
    assignedProviderId: MINE,
  };

  function setup() {
    const service = { update: jest.fn(async () => ({ _id: MINE })) };
    return {
      controller: new AirlinesController(service as any),
      service,
    };
  }

  it("lets the airline's moderator edit it", async () => {
    const { controller, service } = setup();
    await controller.update(moderator, MINE, { name: 'TEST New name' });
    expect(service.update).toHaveBeenCalledWith(MINE, {
      name: 'TEST New name',
    });
  });

  it("refuses another airline's moderator with 403", () => {
    const { controller, service } = setup();
    expect(() => controller.update(moderator, OTHER, { name: 'X' })).toThrow(
      ForbiddenException,
    );
    expect(service.update).not.toHaveBeenCalled();
  });

  it('refuses a hotel moderator and an admin with 403', () => {
    const { controller } = setup();
    for (const role of [Role.HOTEL_MODERATOR, Role.ADMIN]) {
      const user = { ...moderator, role };
      expect(() => controller.update(user, MINE, {})).toThrow(
        ForbiddenException,
      );
    }
  });
});

describe('airline DTOs', () => {
  const errorsOf = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('uppercases and trims the code', () => {
    const dto = plainToInstance(CreateAirlineDto, {
      name: ' TEST Nile Air ',
      code: ' np ',
    });
    expect(dto).toMatchObject({ name: 'TEST Nile Air', code: 'NP' });
  });

  it.each(['N', 'NILE', 'N-P', ''])('rejects code %p', async (code) => {
    expect(await errorsOf(CreateAirlineDto, { name: 'A', code })).toEqual([
      'code',
    ]);
  });

  it('requires a name of at most 100 characters', async () => {
    expect(await errorsOf(CreateAirlineDto, { code: 'NP' })).toEqual(['name']);
    expect(
      await errorsOf(CreateAirlineDto, { name: 'x'.repeat(101), code: 'NP' }),
    ).toEqual(['name']);
  });

  it('allows a partial update', async () => {
    expect(await errorsOf(UpdateAirlineDto, { code: 'msr' })).toEqual([]);
    expect(await errorsOf(UpdateAirlineDto, {})).toEqual([]);
  });
});
