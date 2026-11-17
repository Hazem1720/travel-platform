import { day, itinerary } from './itinerary.fixtures-spec';
import { cityGroups, presentItinerary } from './itinerary.view';

// ITN-09: consecutive days in the same city form a group.
describe('cityGroups (ITN-09)', () => {
  it('groups Cairo, Cairo, Luxor, Cairo into 3 groups of 2, 1 and 1', () => {
    const days = ['cairo', 'cairo', 'luxor', 'cairo'].map((c) => day(c));
    expect(cityGroups(days)).toEqual([
      { cityId: 'cairo', fromDay: 1, toDay: 2, dayCount: 2 },
      { cityId: 'luxor', fromDay: 3, toDay: 3, dayCount: 1 },
      { cityId: 'cairo', fromDay: 4, toDay: 4, dayCount: 1 },
    ]);
  });

  it('gives no groups for an itinerary without days', () => {
    expect(cityGroups([])).toEqual([]);
  });

  it('is part of the itinerary details', () => {
    const shown = presentItinerary(itinerary([day('luxor'), day('luxor')]));
    expect(shown.cityGroups).toEqual([
      { cityId: 'luxor', fromDay: 1, toDay: 2, dayCount: 2 },
    ]);
  });
});
