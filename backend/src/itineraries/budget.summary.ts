import {
  CityGroup,
  DayLike,
  ItineraryLike,
  cityGroups,
  dayDate,
  presentItinerary,
} from './itinerary.view';
import { BudgetCategory } from './schemas/itinerary.schema';

// ITN-14: the summary line for intercity transport (ITN-16), next to the four
// daily categories.
export const INTERCITY_TRANSPORT = 'intercity_transport';
export const SUMMARY_LINES = [
  ...Object.values(BudgetCategory),
  INTERCITY_TRANSPORT,
] as const;
export type SummaryLine = (typeof SUMMARY_LINES)[number];

// Amounts per currency code, e.g. { EGP: 1200, USD: 30 }.
export type CurrencyTotals = Record<string, number>;

export interface BudgetLine {
  dayIndex: number;
  line: SummaryLine;
  amount: number;
  currency: string;
}

interface SummaryDay {
  _id: unknown;
  cityId: string;
  budgets?: { category: BudgetCategory; amount: number; currency: string }[];
  activities?: { cost?: { amount: number; currency: string } | null }[];
}

interface SummaryItinerary {
  startDate: Date;
  days: SummaryDay[];
  transportCosts?: { dayId: unknown; amount: number; currency: string }[];
  // ITN-27 (bonus): linked bookings.
  linkedBookings?: {
    dayId: unknown;
    type: string;
    amount: number;
    currency: string;
  }[];
}

// Every amount that counts in the budget: the budget entries, the activity
// costs (under Activities), the intercity transport costs (own line) and,
// ITN-27, the linked bookings (hotels under Accommodation, flights under
// Intercity transport).
export function budgetLines(itinerary: SummaryItinerary): BudgetLine[] {
  const lines: BudgetLine[] = [];
  const indexOf = new Map(
    itinerary.days.map((d, i) => [String(d._id), i] as const),
  );
  itinerary.days.forEach((day, dayIndex) => {
    for (const b of day.budgets ?? []) {
      lines.push({ dayIndex, line: b.category, ...money(b) });
    }
    for (const a of day.activities ?? []) {
      if (a.cost) {
        lines.push({
          dayIndex,
          line: BudgetCategory.ACTIVITIES,
          ...money(a.cost),
        });
      }
    }
  });
  for (const t of itinerary.transportCosts ?? []) {
    const dayIndex = indexOf.get(String(t.dayId));
    if (dayIndex !== undefined) {
      lines.push({ dayIndex, line: INTERCITY_TRANSPORT, ...money(t) });
    }
  }
  for (const b of itinerary.linkedBookings ?? []) {
    const dayIndex = indexOf.get(String(b.dayId));
    if (dayIndex !== undefined) {
      lines.push({
        dayIndex,
        line:
          b.type === 'hotel'
            ? BudgetCategory.ACCOMMODATION
            : INTERCITY_TRANSPORT,
        ...money(b),
      });
    }
  }
  return lines;
}

function money(m: { amount: number; currency: string }) {
  return { amount: m.amount, currency: m.currency };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function addTo(totals: CurrencyTotals, currency: string, amount: number) {
  totals[currency] = round2((totals[currency] ?? 0) + amount);
}

function emptyByLine<T>(make: () => T): Record<SummaryLine, T> {
  return Object.fromEntries(SUMMARY_LINES.map((l) => [l, make()])) as Record<
    SummaryLine,
    T
  >;
}

export interface DaySummary<T> {
  dayId: unknown;
  number: number;
  date: Date;
  cityId: string;
  total: T;
  byCategory: Record<SummaryLine, T>;
}

export type GroupSummary<T> = CityGroup & { budgetSubtotal: T };

export interface BudgetSummary<T> {
  total: T;
  byCategory: Record<SummaryLine, T>;
  byDay: DaySummary<T>[];
  cityGroups: GroupSummary<T>[];
}

// ITN-14: totals by category and by day, in the entries' own currencies
// (ITN-18 converts them to one currency).
export function summarizeByCurrency(
  itinerary: SummaryItinerary,
): BudgetSummary<CurrencyTotals> {
  return summarize(
    itinerary,
    () => ({}),
    (totals, line) => addTo(totals, line.currency, line.amount),
  );
}

// The shared engine: `empty` makes a zero total and `add` adds one line.
export function summarize<T>(
  itinerary: SummaryItinerary,
  empty: () => T,
  add: (total: T, line: BudgetLine) => void,
): BudgetSummary<T> {
  const total = empty();
  const byCategory = emptyByLine(empty);
  const byDay: DaySummary<T>[] = itinerary.days.map((d, i) => ({
    dayId: d._id,
    number: i + 1,
    date: dayDate(itinerary.startDate, i),
    cityId: d.cityId,
    total: empty(),
    byCategory: emptyByLine(empty),
  }));
  for (const line of budgetLines(itinerary)) {
    add(total, line);
    add(byCategory[line.line], line);
    add(byDay[line.dayIndex].total, line);
    add(byDay[line.dayIndex].byCategory[line.line], line);
  }
  // ITN-09: each city group's subtotal is the sum of its days.
  const groups = cityGroups(itinerary.days).map((g) => {
    const budgetSubtotal = empty();
    for (const line of budgetLines(itinerary)) {
      if (line.dayIndex >= g.fromDay - 1 && line.dayIndex <= g.toDay - 1) {
        add(budgetSubtotal, line);
      }
    }
    return { ...g, budgetSubtotal };
  });
  return { total, byCategory, byDay, cityGroups: groups };
}

// What the owner sees in the itinerary details: numbered days and city groups
// with their budget subtotal in the entries' own currencies (ITN-09, ITN-14).
export function presentWithBudget<
  T extends SummaryItinerary & ItineraryLike<DayLike>,
>(itinerary: T) {
  return {
    ...presentItinerary(itinerary),
    cityGroups: summarizeByCurrency(itinerary).cityGroups,
  };
}

// ITN-18: the same summary with every amount converted to one currency and
// rounded to 2 decimals at the end.
export function summarizeConverted(
  itinerary: SummaryItinerary,
  convert: (amount: number, currency: string) => number,
): BudgetSummary<number> {
  const box = () => ({ value: 0 });
  const raw = summarize(itinerary, box, (t, line) => {
    t.value += convert(line.amount, line.currency);
  });
  const v = (b: { value: number }) => round2(b.value);
  const lines = (r: Record<SummaryLine, { value: number }>) =>
    Object.fromEntries(Object.entries(r).map(([k, b]) => [k, v(b)])) as Record<
      SummaryLine,
      number
    >;
  return {
    total: v(raw.total),
    byCategory: lines(raw.byCategory),
    byDay: raw.byDay.map((d) => ({
      ...d,
      total: v(d.total),
      byCategory: lines(d.byCategory),
    })),
    cityGroups: raw.cityGroups.map((g) => ({
      ...g,
      budgetSubtotal: v(g.budgetSubtotal),
    })),
  };
}
