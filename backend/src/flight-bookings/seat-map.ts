import { CabinCategory } from '../flights/schemas/flight.schema';

// FLT-28 (bonus): the seat map of a cabin, derived from its number of seats.
// Business and First have 4 seats a row (A, C, D, F), the other cabins 6
// (A to F). Rows are numbered from 1 in each cabin; the last row may be
// shorter. "12A" is row 12, seat A.
export function seatLetters(category: CabinCategory): string[] {
  return category === CabinCategory.BUSINESS || category === CabinCategory.FIRST
    ? ['A', 'C', 'D', 'F']
    : ['A', 'B', 'C', 'D', 'E', 'F'];
}

export function seatLabels(category: CabinCategory, total: number): string[] {
  const letters = seatLetters(category);
  return Array.from(
    { length: total },
    (_, i) =>
      `${Math.floor(i / letters.length) + 1}${letters[i % letters.length]}`,
  );
}

// "12a" -> "12A"; anything else that is not a seat of the cabin -> null.
export function normalizeSeat(
  category: CabinCategory,
  total: number,
  seat: string,
): string | null {
  const label = seat.trim().toUpperCase();
  return seatLabels(category, total).includes(label) ? label : null;
}
