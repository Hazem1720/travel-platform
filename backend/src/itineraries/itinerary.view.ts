const DAY_MS = 24 * 60 * 60 * 1000;

// ITN-05: a day's date is the start date plus (number - 1) days, always
// computed, never stored, so changing the start date or the order of days
// moves every date at once.
export function dayDate(startDate: Date, index: number): Date {
  return new Date(new Date(startDate).getTime() + index * DAY_MS);
}

// "2026-12-01" for a UTC-midnight date.
export function toDateOnly(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

export interface DayLike {
  _id: unknown;
  cityId: string;
}

export interface ItineraryLike<D extends DayLike> {
  startDate: Date;
  days: D[];
}

export type NumberedDay<D> = D & { number: number; date: Date };

// Adds each day's number (position + 1) and date.
export function numberDays<D extends DayLike>(
  itinerary: ItineraryLike<D>,
): NumberedDay<D>[] {
  return itinerary.days.map((day, i) => ({
    ...day,
    number: i + 1,
    date: dayDate(itinerary.startDate, i),
  }));
}

export type PresentedItinerary<T extends ItineraryLike<DayLike>> = Omit<
  T,
  'days'
> & { days: NumberedDay<T['days'][number]>[] };

// What the owner sees: the itinerary with numbered, dated days.
export function presentItinerary<T extends ItineraryLike<DayLike>>(
  itinerary: T,
): PresentedItinerary<T> {
  return { ...itinerary, days: numberDays(itinerary) };
}
