// pdfkit exports its class as the whole CommonJS module; the namespace import
// compiles to require('pdfkit') (as in flight-bookings/e-ticket.pdf.ts).
import * as PDFKit from 'pdfkit';
import {
  CurrencyTotals,
  SUMMARY_LINES,
  SummaryLine,
} from '../itineraries/budget.summary';

const PDFDocument = PDFKit as unknown as new (
  options?: PDFKit.PDFDocumentOptions,
) => PDFKit.PDFDocument;

export interface PdfActivity {
  name: string;
  description?: string;
  time?: string | null;
  cost?: { amount: number; currency: string } | null;
}

export interface PdfDay {
  number: number;
  date: string;
  city: string;
  notes?: string;
  activities: PdfActivity[];
  budgets: {
    category: string;
    amount: number;
    currency: string;
    note?: string;
  }[];
  total: CurrencyTotals;
}

export interface PdfItinerary {
  title: string;
  countries: string[];
  startDate: string;
  endDate: string;
  visibility: string;
  days: PdfDay[];
  transport: {
    mode: string;
    from: string;
    to: string;
    amount: number;
    currency: string;
  }[];
  total: CurrencyTotals;
  byCategory: Record<SummaryLine, CurrencyTotals>;
}

const LINE_LABEL: Record<string, string> = {
  food: 'Food',
  accommodation: 'Accommodation',
  in_city_transport: 'In-city transport',
  activities: 'Activities',
  intercity_transport: 'Intercity transport',
};

// Itinerary amounts are in the currency's main unit (150.5 EGP), not cents.
const money = (amount: number, currency: string) =>
  `${amount.toFixed(2)} ${currency}`;

// "1200.00 EGP + 30.00 USD", or "-" when nothing is planned.
export function totals(t: CurrencyTotals): string {
  const parts = Object.entries(t)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => money(v, c));
  return parts.length ? parts.join(' + ') : '-';
}

// ITN-28: the itinerary as a printable PDF: every day with its city,
// activities and budget entries, the intercity transport, and the budget
// per category and in total (one total per currency, as ITN-14 shows it).
// compress: false keeps the text readable in tests.
export function renderItineraryPdf(
  it: PdfItinerary,
  { compress = true }: { compress?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      compress,
      info: { Title: it.title },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).text(it.title);
    doc
      .fontSize(10)
      .fillColor('#555')
      .text(
        `${it.startDate} to ${it.endDate}  |  ${it.days.length} day${
          it.days.length === 1 ? '' : 's'
        }  |  ${it.countries.join(', ')}  |  ${it.visibility}`,
      )
      .fillColor('black');

    doc.moveDown(1);
    doc.fontSize(14).text('Budget');
    doc.fontSize(11);
    for (const line of SUMMARY_LINES) {
      doc.text(`${LINE_LABEL[line]}: ${totals(it.byCategory[line])}`);
    }
    doc.text(`Total: ${totals(it.total)}`, { underline: true });

    for (const day of it.days) {
      doc.moveDown(1.2);
      doc
        .fontSize(14)
        .text(`Day ${day.number}  -  ${day.date}  -  ${day.city}`);
      doc.fontSize(11);
      if (day.notes) doc.fillColor('#555').text(day.notes).fillColor('black');
      if (day.activities.length) {
        doc.moveDown(0.3).text('Activities:');
        for (const a of day.activities) {
          const cost = a.cost
            ? `  (${money(a.cost.amount, a.cost.currency)})`
            : '';
          doc.text(`  - ${a.time ? `${a.time} ` : ''}${a.name}${cost}`);
          if (a.description) {
            doc
              .fillColor('#555')
              .text(`    ${a.description}`)
              .fillColor('black');
          }
        }
      }
      if (day.budgets.length) {
        doc.moveDown(0.3).text('Budget entries:');
        for (const b of day.budgets) {
          doc.text(
            `  - ${LINE_LABEL[b.category] ?? b.category}: ${money(b.amount, b.currency)}${
              b.note ? ` (${b.note})` : ''
            }`,
          );
        }
      }
      doc.text(`Day total: ${totals(day.total)}`);
    }

    if (it.transport.length) {
      doc.moveDown(1.2);
      doc.fontSize(14).text('Intercity transport');
      doc.fontSize(11);
      for (const t of it.transport) {
        doc.text(
          `  - ${t.mode}: ${t.from} to ${t.to}, ${money(t.amount, t.currency)}`,
        );
      }
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text('Planning figures only; nothing here is booked or charged.');
    doc.end();
  });
}
