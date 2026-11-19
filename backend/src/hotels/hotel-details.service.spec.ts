import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BOTH_DATES, DETAILS_REVIEWS, HotelsService } from './hotels.service';

// HTL-02: the public hotel details page.
describe('HotelsService.details (HTL-02)', () => {
  const ID = '6735a1f4c1a2b3c4d5e6f801';
  const hotel = {
    _id: ID,
    name: 'TEST Nile View',
    cityId: 'cairo',
    isActive: true,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
    ratingAverage: 4.5,
    ratingCount: 2,
  };
  const review = {
    _id: '6735a1f4c1a2b3c4d5e6fb01',
    rating: 5,
    text: 'Lovely',
    createdAt: new Date('2026-11-16T10:00:00Z'),
  };
  const freeRoom = {
    _id: '6735a1f4c1a2b3c4d5e6f901',
    hotelId: ID,
    name: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 12000,
    bookableRanges: [],
    isActive: true,
  };

  function setup(opts: { found?: unknown; today?: string } = {}) {
    const found = 'found' in opts ? opts.found : hotel;
    const hotels = { findById: jest.fn(() => ({ lean: async () => found })) };
    const chain = {
      sort: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      lean: async () => [review],
    };
    const reviews = { find: jest.fn(() => chain) };
    const availability = { freeRooms: jest.fn(async () => [freeRoom]) };
    const search = { today: jest.fn(async () => opts.today ?? '2026-11-19') };
    const service = new HotelsService(
      hotels as any,
      {} as any,
      {} as any,
      reviews as any,
      availability as any,
      search as any,
    );
    return { service, reviews, chain, availability, search };
  }

  it('without dates: the profile and the newest visible reviews, no rooms', async () => {
    const { service, reviews, chain, availability } = setup();
    const page = await service.details(ID, {});
    expect(page).toMatchObject({
      ...hotel,
      availableRooms: [],
      checkIn: null,
      checkOut: null,
      reviews: [
        {
          id: review._id,
          rating: 5,
          text: 'Lovely',
          createdAt: review.createdAt,
        },
      ],
    });
    // Hidden reviews never show; newest first; at most 10.
    expect(reviews.find).toHaveBeenCalledWith(
      { hotelId: ID, hidden: false },
      { rating: 1, text: 1, createdAt: 1 },
    );
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.limit).toHaveBeenCalledWith(DETAILS_REVIEWS);
    expect(availability.freeRooms).not.toHaveBeenCalled();
  });

  it('with dates: only the free rooms, with the total for the stay', async () => {
    const { service, availability } = setup();
    const page = await service.details(ID, {
      checkIn: '2026-12-05',
      checkOut: '2026-12-08',
    });
    expect(availability.freeRooms).toHaveBeenCalledWith(
      ID,
      '2026-12-05',
      '2026-12-08',
    );
    expect(page.availableRooms).toEqual([
      {
        id: freeRoom._id,
        name: '101',
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        pricePerNight: 12000,
        nights: 3,
        totalPrice: 36000,
      },
    ]);
    expect(page).toMatchObject({
      checkIn: '2026-12-05',
      checkOut: '2026-12-08',
    });
  });

  it('an inactive or unknown hotel is 404', async () => {
    await expect(
      setup({ found: { ...hotel, isActive: false } }).service.details(ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ found: null }).service.details(ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('needs both dates or neither (400)', async () => {
    const { service } = setup();
    await expect(
      service.details(ID, { checkIn: '2026-12-05' }),
    ).rejects.toThrow(BadRequestException);
    const err = await service
      .details(ID, { checkOut: '2026-12-08' })
      .catch((e: BadRequestException) => e);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      details: { checkIn: [BOTH_DATES] },
    });
  });

  it('refuses checkOut on or before checkIn, and a check-in in the past (400)', async () => {
    const { service, availability } = setup({ today: '2026-11-19' });
    await expect(
      service.details(ID, { checkIn: '2026-12-08', checkOut: '2026-12-05' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.details(ID, { checkIn: '2026-11-18', checkOut: '2026-11-20' }),
    ).rejects.toThrow(BadRequestException);
    expect(availability.freeRooms).not.toHaveBeenCalled();
  });
});
