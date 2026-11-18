import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { UploadedImage } from '../uploads/image-file';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';

// FLT-08 (baggage), FLT-09 (cancellation tiers route), FLT-01 (logo).
const ID = '6735a1f4c1a2b3c4d5e6f701';
const OTHER = '6735a1f4c1a2b3c4d5e6f702';
const OLD_LOGO = '/api/uploads/11111111-1111-1111-1111-111111111111.png';
const NEW_LOGO = '/api/uploads/22222222-2222-2222-2222-222222222222.png';
const file = { originalname: 'logo.png' } as UploadedImage;

function setup(current: any = { _id: ID, logo: OLD_LOGO }) {
  const model = {
    findById: jest.fn(() => ({ lean: async () => current })),
    findByIdAndUpdate: jest.fn<any, [string, any, any]>(() => ({
      lean: async () => current && { ...current, updated: true },
    })),
  };
  const uploads = {
    save: jest.fn(async () => [NEW_LOGO]),
    remove: jest.fn(async () => undefined),
  };
  const service = new AirlinesService(model as any, uploads as any);
  return { service, model, uploads };
}

describe('airline policies (FLT-08, FLT-09)', () => {
  it('replaces the baggage policy', async () => {
    const { service, model } = setup();
    const policy = { extraBagPrice: 3000, maxExtraBags: 2 };
    await service.setBaggagePolicy(ID, policy);
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      ID,
      { $set: { extraBagPrice: 3000, maxExtraBags: 2 } },
      { new: true, runValidators: true },
    );
  });

  it('replaces the cancellation tiers', async () => {
    const { service, model } = setup();
    const tiers = [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
    ];
    await service.setCancellationPolicy(ID, { tiers });
    expect(model.findByIdAndUpdate.mock.calls[0][1]).toEqual({
      $set: { cancellationTiers: tiers },
    });
  });

  it('answers 404 for an unknown airline', async () => {
    const { service } = setup(null);
    await expect(
      service.setBaggagePolicy(ID, { extraBagPrice: 1, maxExtraBags: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    [{ extraBagPrice: 0, maxExtraBags: 1 }, 'extraBagPrice'],
    [{ extraBagPrice: 99.5, maxExtraBags: 1 }, 'extraBagPrice'],
    [{ extraBagPrice: 3000, maxExtraBags: -1 }, 'maxExtraBags'],
    [{ extraBagPrice: 3000, maxExtraBags: 1.5 }, 'maxExtraBags'],
  ])('rejects %p', async (body, field) => {
    const errors = await validate(plainToInstance(BaggagePolicyDto, body));
    expect(errors.map((e) => e.property)).toEqual([field]);
  });

  it('accepts 0 extra bags', async () => {
    const dto = plainToInstance(BaggagePolicyDto, {
      extraBagPrice: 3000,
      maxExtraBags: 0,
    });
    expect(await validate(dto)).toEqual([]);
  });
});

describe('airline logo (FLT-01)', () => {
  it('stores the new logo and deletes the old file', async () => {
    const { service, model, uploads } = setup();
    await service.setLogo(ID, [file]);
    expect(uploads.save).toHaveBeenCalledWith([file]);
    expect(model.findByIdAndUpdate.mock.calls[0][1]).toEqual({
      $set: { logo: NEW_LOGO },
    });
    expect(uploads.remove).toHaveBeenCalledWith(OLD_LOGO);
  });

  it('deletes nothing when there was no logo', async () => {
    const { service, uploads } = setup({ _id: ID, logo: null });
    await service.setLogo(ID, [file]);
    expect(uploads.remove).not.toHaveBeenCalled();
  });

  it('stores nothing for an unknown airline', async () => {
    const { service, uploads } = setup(null);
    await expect(service.setLogo(ID, [file])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(uploads.save).not.toHaveBeenCalled();
  });
});

describe('only the airline moderator changes policies and the logo', () => {
  const service = {
    setBaggagePolicy: jest.fn(),
    setCancellationPolicy: jest.fn(),
    setLogo: jest.fn(),
  };
  const controller = new AirlinesController(service as any);
  const moderator: AuthUser = {
    id: 'u1',
    role: Role.AIRLINE_MODERATOR,
    assignedProviderId: ID,
  };

  it("refuses another airline's moderator with 403", () => {
    const bags = { extraBagPrice: 1, maxExtraBags: 0 };
    expect(() => controller.setBaggagePolicy(moderator, OTHER, bags)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      controller.setCancellationPolicy(moderator, OTHER, { tiers: [] }),
    ).toThrow(ForbiddenException);
    expect(() => controller.setLogo(moderator, OTHER, [file])).toThrow(
      ForbiddenException,
    );
    expect(service.setBaggagePolicy).not.toHaveBeenCalled();
    expect(service.setCancellationPolicy).not.toHaveBeenCalled();
    expect(service.setLogo).not.toHaveBeenCalled();
  });

  it('lets its own moderator through', () => {
    controller.setLogo(moderator, ID, [file]);
    expect(service.setLogo).toHaveBeenCalledWith(ID, [file]);
  });
});
