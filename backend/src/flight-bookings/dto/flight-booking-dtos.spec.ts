import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { passengerCounts } from '../flight-booking.rules';
import { FlightQuoteDto } from './flight-quote.dto';
import { FlightSearchQueryDto } from './flight-search-query.dto';

// The DTOs through the app's real validation pipe (GEN-02 error format).
describe('flight search and quote input (FLT-11, FLT-12, FLT-19)', () => {
  const pipe = createValidationPipe();

  async function validate(
    metatype: any,
    value: object,
    type: 'query' | 'body',
  ) {
    return pipe.transform(value, { type, metatype });
  }
  async function fieldsRejected(
    metatype: any,
    value: object,
    type: 'query' | 'body',
  ) {
    try {
      await validate(metatype, value, type);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return Object.keys((e as BadRequestException).getResponse()['details']);
    }
    throw new Error('expected a 400');
  }

  describe('GET /flights/search query', () => {
    it('converts query strings and applies defaults', async () => {
      const q = await validate(
        FlightSearchQueryDto,
        { from: 'cai', to: 'dxb', date: '2026-12-02', children: '1' },
        'query',
      );
      expect(q).toMatchObject({
        from: 'CAI',
        to: 'DXB',
        children: 1,
        page: 1,
        limit: 10,
      });
      // adults and infants stay unset; passengerCounts() fills in 1 and 0.
      expect(q.adults).toBeUndefined();
      expect(passengerCounts(q)).toEqual({
        adults: 1,
        children: 1,
        infants: 0,
      });
    });

    it('rejects bad codes, dates, cabins and prices', async () => {
      const fields = await fieldsRejected(
        FlightSearchQueryDto,
        {
          from: 'CAIRO',
          to: 'D1B',
          date: '2026-02-30',
          cabin: 'Luxury',
          minPrice: '-1',
        },
        'query',
      );
      expect(fields.sort()).toEqual([
        'cabin',
        'date',
        'from',
        'minPrice',
        'to',
      ]);
    });

    it('accepts ?passengers=3 as 3 adults (FLT-11)', async () => {
      const q = await validate(
        FlightSearchQueryDto,
        { from: 'CAI', to: 'DXB', date: '2026-12-02', passengers: '3' },
        'query',
      );
      expect(passengerCounts(q)).toEqual({
        adults: 3,
        children: 0,
        infants: 0,
      });
    });

    it('rejects passengers=0', async () => {
      expect(
        await fieldsRejected(
          FlightSearchQueryDto,
          { from: 'CAI', to: 'DXB', date: '2026-12-02', passengers: '0' },
          'query',
        ),
      ).toEqual(['passengers']);
    });

    it('rejects unknown parameters', async () => {
      const fields = await fieldsRejected(
        FlightSearchQueryDto,
        { from: 'CAI', to: 'DXB', date: '2026-12-02', role: 'admin' },
        'query',
      );
      expect(fields).toEqual(['role']);
    });
  });

  describe('POST /flight-bookings body', () => {
    const passenger = {
      type: 'adult',
      fullName: '  Sara Ali ',
      dateOfBirth: '1995-04-17',
      passportNumber: 'a12345678',
      extraBags: [{ weightKg: 23 }],
    };
    const body = {
      outboundFlightId: '6737a1f4c1a2b3c4d5e6f101',
      cabin: 'Economy',
      passengers: [passenger],
    };

    it('accepts a valid quote and cleans the text', async () => {
      const dto = await validate(FlightQuoteDto, body, 'body');
      expect(dto.passengers[0]).toMatchObject({
        fullName: 'Sara Ali',
        passportNumber: 'A12345678',
      });
    });

    it('needs at least one passenger', async () => {
      expect(
        await fieldsRejected(
          FlightQuoteDto,
          { ...body, passengers: [] },
          'body',
        ),
      ).toEqual(['passengers']);
    });

    it('names the nested field that is wrong', async () => {
      const fields = await fieldsRejected(
        FlightQuoteDto,
        {
          ...body,
          passengers: [
            passenger,
            {
              ...passenger,
              type: 'baby',
              dateOfBirth: '17/04/1995',
              extraBags: [{ weightKg: 0 }],
            },
          ],
        },
        'body',
      );
      expect(fields.sort()).toEqual([
        'passengers.1.dateOfBirth',
        'passengers.1.extraBags.0.weightKg',
        'passengers.1.type',
      ]);
    });

    it('rejects a self-set price or status', async () => {
      const fields = await fieldsRejected(
        FlightQuoteDto,
        { ...body, totalAmount: 1, status: 'Confirmed' },
        'body',
      );
      expect(fields.sort()).toEqual(['status', 'totalAmount']);
    });
  });
});
