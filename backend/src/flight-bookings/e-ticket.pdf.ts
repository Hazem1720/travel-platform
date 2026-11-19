// pdfkit exports its class as the whole CommonJS module. This project
// compiles without esModuleInterop, so a default import would be undefined;
// the namespace import compiles to require('pdfkit'), the class itself.
import * as PDFKit from 'pdfkit';
import { FlightBookingView } from './flight-confirmation.service';

const PDFDocument = PDFKit as unknown as new (
  options?: PDFKit.PDFDocumentOptions,
) => PDFKit.PDFDocument;

const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;
const local = (iso: string) => iso.replace('T', ' ');

// FLT-23: the e-ticket of a Confirmed booking as a PDF: reference, every
// flight with local departure and arrival times, passengers and the total.
// Passport numbers are left out: the ticket is often printed or forwarded.
// compress: false keeps the text readable in tests.
export function renderETicket(
  booking: FlightBookingView,
  { compress = true }: { compress?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      compress,
      info: { Title: `E-ticket ${booking.reference}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).text('Flight e-ticket');
    doc.moveDown(0.5);
    doc.fontSize(14).text(`Booking reference: ${booking.reference}`);
    doc
      .fontSize(10)
      .fillColor('#555')
      .text(
        `Status: ${booking.status}   Confirmed: ${
          booking.confirmedAt
            ? new Date(booking.confirmedAt).toISOString().slice(0, 16)
            : '-'
        } UTC`,
      )
      .fillColor('black');

    booking.segments.forEach((s, i) => {
      doc.moveDown(1.2);
      doc
        .fontSize(13)
        .text(
          `${booking.segments.length > 1 ? (i === 0 ? 'Outbound' : 'Return') : 'Flight'}: ${s.flightNumber}  ${s.from} to ${s.to}`,
        );
      doc.fontSize(11);
      doc.text(
        `Departure: ${local(s.departure.local)} local time (${s.departure.timeZone}, UTC${s.departure.utcOffset})`,
      );
      doc.text(
        `Arrival:   ${local(s.arrival.local)} local time (${s.arrival.timeZone}, UTC${s.arrival.utcOffset})`,
      );
      doc.text(`Cabin: ${s.cabin}   Seats: ${s.seats}`);
    });

    doc.moveDown(1.2);
    doc.fontSize(13).text('Passengers');
    doc.fontSize(11);
    booking.passengers.forEach((p, i) => {
      const bags = p.extraBags?.length
        ? `, ${p.extraBags.length} extra bag(s): ${p.extraBags
            .map((b) => `${b.weightKg} kg`)
            .join(', ')}`
        : '';
      doc.text(`${i + 1}. ${p.fullName} (${p.type})${bags}`);
    });

    doc.moveDown(1.2);
    doc.fontSize(13).text(`Total paid: ${usd(booking.totalAmount)}`);
    doc.end();
  });
}
