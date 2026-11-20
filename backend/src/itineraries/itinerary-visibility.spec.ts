import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ItinerariesService } from './itineraries.service';
import { ItineraryVisibility } from './schemas/itinerary.schema';

// ITN-20: Public or Private, set by the owner on PATCH /itineraries/:id.
describe('Itinerary visibility (ITN-20)', () => {
  const ID = '6735a1f4c1a2b3c4d5e6f901';
  const owner: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f001',
    role: Role.USER,
    assignedProviderId: null,
  };
  const stranger: AuthUser = { ...owner, id: '6735a1f4c1a2b3c4d5e6f002' };

  function setup() {
    const itineraries = {
      findById: jest.fn(() => ({
        lean: async () => ({ _id: ID, ownerId: owner.id }),
      })),
      findOneAndUpdate: jest.fn<any, [object, any, object]>((_f, update) => ({
        lean: async () => ({ _id: ID, ...update.$set }),
      })),
    };
    return {
      service: new ItinerariesService(itineraries as any, {} as any),
      itineraries,
    };
  }

  it.each([ItineraryVisibility.PUBLIC, ItineraryVisibility.PRIVATE])(
    'lets the owner set %s',
    async (visibility) => {
      const { service, itineraries } = setup();
      const updated = await service.update(owner, ID, { visibility });
      expect(itineraries.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $set: { visibility },
      });
      expect(updated).toMatchObject({ visibility });
    },
  );

  it('does not let another user change it (404)', async () => {
    const { service, itineraries } = setup();
    await expect(
      service.update(stranger, ID, { visibility: ItineraryVisibility.PUBLIC }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(itineraries.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('accepts only Public or Private (400 otherwise)', async () => {
    const errors = await validate(
      plainToInstance(UpdateItineraryDto, { visibility: 'Friends' }),
    );
    expect(errors.map((e) => e.property)).toEqual(['visibility']);
  });
});
