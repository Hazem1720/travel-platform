import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ActivitiesService } from './activities.service';
import { ActivityImagesService } from './activity-images.service';
import { OWNER, STRANGER, day, itinerary } from './itinerary.fixtures-spec';

// ITN-12: images on an activity, up to 5, JPG or PNG (GEN-08).
describe('ActivityImagesService (ITN-12)', () => {
  const png = (name = 'a.png') => ({
    originalname: name,
    mimetype: 'image/png',
    size: 10,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  });

  function setup(existing: string[] = [], stillUsed = false) {
    const activity = {
      _id: new Types.ObjectId(),
      name: 'Museum',
      images: [...existing],
    };
    const doc: any = itinerary([day('cairo', { activities: [activity] })]);
    const itineraries = {
      findOne: jest.fn(() => ({ lean: async () => doc })),
      findOneAndUpdate: jest.fn<any, [any, any, any]>((_f, update) => ({
        lean: async () => {
          const push = update.$push?.['days.$[d].activities.$[a].images'];
          if (push) activity.images.push(...push.$each);
          const pull = update.$pull?.['days.$[d].activities.$[a].images'];
          if (pull) activity.images = activity.images.filter((u) => u !== pull);
          return doc;
        },
      })),
      updateOne: jest.fn(async () => ({})),
      exists: jest.fn(async () => (stillUsed ? { _id: 'x' } : null)),
    };
    let n = 0;
    const uploads = {
      save: jest.fn(async (files: unknown[]) =>
        files.map(() => `/api/uploads/f${++n}.png`),
      ),
      remove: jest.fn(async () => undefined),
    };
    const activities = new ActivitiesService(
      itineraries as any,
      {} as any,
      {} as any,
    );
    const service = new ActivityImagesService(
      itineraries as any,
      activities,
      uploads as any,
    );
    return { service, itineraries, uploads, activity };
  }

  it('uploads 2 PNGs and lists them', async () => {
    const { service, activity } = setup();
    const result = await service.addImages(OWNER, String(activity._id), [
      png(),
      png('b.png'),
    ]);
    expect(result.images).toEqual([
      '/api/uploads/f1.png',
      '/api/uploads/f2.png',
    ]);
  });

  it('refuses a sixth image (400) before saving anything', async () => {
    const five = [1, 2, 3, 4, 5].map((i) => `/api/uploads/x${i}.png`);
    const { service, uploads, activity } = setup(five);
    await expect(
      service.addImages(OWNER, String(activity._id), [png()]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.save).not.toHaveBeenCalled();
  });

  it('deletes the saved files if a parallel upload filled the slots', async () => {
    const { service, itineraries, uploads, activity } = setup();
    itineraries.findOneAndUpdate.mockImplementationOnce(() => ({
      lean: async () => null,
    }));
    await expect(
      service.addImages(OWNER, String(activity._id), [png()]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.remove).toHaveBeenCalledWith('/api/uploads/f1.png');
  });

  it('removes an image and deletes its file', async () => {
    const { service, uploads, activity } = setup(['/api/uploads/x1.png']);
    const result = await service.removeImage(
      OWNER,
      String(activity._id),
      'x1.png',
    );
    expect(result.images).toEqual([]);
    expect(uploads.remove).toHaveBeenCalledWith('/api/uploads/x1.png');
  });

  it('keeps the file while a clone still uses it', async () => {
    const { service, uploads, activity } = setup(['/api/uploads/x1.png'], true);
    await service.removeImage(OWNER, String(activity._id), 'x1.png');
    expect(uploads.remove).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown image or another user', async () => {
    const { service, activity } = setup(['/api/uploads/x1.png']);
    await expect(
      service.removeImage(OWNER, String(activity._id), 'nope.png'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.addImages(STRANGER, String(activity._id), [png()]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
