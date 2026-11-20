import { qualifyingRooms } from './hotel-search.service';

// HTL-12: the hotel's price is its cheapest QUALIFYING room.
describe('HTL-12: qualifying rooms for the search price', () => {
  const A = { name: 'A', maxOccupancy: 1, pricePerNight: 5000 };
  const B = { name: 'B', maxOccupancy: 3, pricePerNight: 12000 };
  const C = { name: 'C', maxOccupancy: 2, pricePerNight: 8000 };
  const names = (rs: { name: string }[]) => rs.map((r) => r.name).sort();

  it('one room: only rooms that hold every guest on their own', () => {
    expect(names(qualifyingRooms([A, B, C], 3, 1))).toEqual(['B']);
    expect(names(qualifyingRooms([A, B, C], 2, 1))).toEqual(['B', 'C']);
    expect(names(qualifyingRooms([A, B, C], 1, 1))).toEqual(['A', 'B', 'C']);
  });

  it('several rooms: a room qualifies with the largest others', () => {
    // 4 guests in 2 rooms: A+B = 4, B+C = 5, A+C = 3 (C needs B).
    expect(names(qualifyingRooms([A, B, C], 4, 2))).toEqual(['A', 'B', 'C']);
    // 5 guests in 2 rooms: only B+C.
    expect(names(qualifyingRooms([A, B, C], 5, 2))).toEqual(['B', 'C']);
  });

  it('none when there are fewer free rooms than asked for', () => {
    expect(qualifyingRooms([B], 2, 2)).toEqual([]);
  });
});
