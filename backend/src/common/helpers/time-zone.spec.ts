import { BadRequestException } from '@nestjs/common';
import {
  isValidTimeZone,
  localDate,
  localDayRangeUtc,
  localDaysUntil,
  localToUtc,
  toZonedTime,
  utcOffset,
  utcToLocal,
} from './time-zone';

// GEN-06, FLT-03: local airport times <-> UTC.
const utc = (local: string, zone: string) =>
  localToUtc(local, zone).toISOString();

describe('time-zone helpers', () => {
  describe('localToUtc and utcToLocal', () => {
    it.each([
      ['2026-12-01T14:30', 'Africa/Cairo', '2026-12-01T12:30:00.000Z'],
      ['2026-12-01T14:30', 'Asia/Dubai', '2026-12-01T10:30:00.000Z'],
      ['2026-12-01T14:30', 'Europe/Berlin', '2026-12-01T13:30:00.000Z'],
      ['2026-07-01T14:30', 'Europe/Berlin', '2026-07-01T12:30:00.000Z'],
    ])('%s in %s is %s and back', (local, zone, expected) => {
      expect(utc(local, zone)).toBe(expected);
      expect(utcToLocal(new Date(expected), zone)).toBe(local);
    });

    it('accepts seconds and an ISO string for utcToLocal', () => {
      expect(utc('2026-12-01T14:30:00', 'Asia/Dubai')).toBe(
        '2026-12-01T10:30:00.000Z',
      );
      expect(utcToLocal('2026-12-01T10:30:00.000Z', 'Asia/Dubai')).toBe(
        '2026-12-01T14:30',
      );
    });

    it('crosses midnight: 22:30 UTC on 1 Dec is 00:30 in Cairo on 2 Dec', () => {
      expect(utcToLocal('2026-12-01T22:30:00Z', 'Africa/Cairo')).toBe(
        '2026-12-02T00:30',
      );
    });

    it('follows the daylight-saving change in Berlin (+1 before, +2 after)', () => {
      expect(utc('2026-03-28T12:00', 'Europe/Berlin')).toBe(
        '2026-03-28T11:00:00.000Z',
      );
      expect(utc('2026-03-29T12:00', 'Europe/Berlin')).toBe(
        '2026-03-29T10:00:00.000Z',
      );
      expect(utcOffset('2026-03-28T12:00:00Z', 'Europe/Berlin')).toBe('+01:00');
      expect(utcOffset('2026-03-29T12:00:00Z', 'Europe/Berlin')).toBe('+02:00');
    });

    it('rejects a local time skipped when the clocks move forward', () => {
      expect(() => localToUtc('2026-03-29T02:30', 'Europe/Berlin')).toThrow(
        BadRequestException,
      );
    });

    it('uses the first occurrence of a time repeated when the clocks go back', () => {
      // 02:30 happens twice in Berlin on 25 Oct 2026: 00:30 UTC and 01:30 UTC.
      expect(utc('2026-10-25T02:30', 'Europe/Berlin')).toBe(
        '2026-10-25T00:30:00.000Z',
      );
      expect(utcToLocal('2026-10-25T01:30:00Z', 'Europe/Berlin')).toBe(
        '2026-10-25T02:30',
      );
    });

    it.each([
      '2026-12-01 14:30',
      '2026-12-01T14:30Z',
      '2026-12-01T14:30+02:00',
      '2026-02-30T10:00',
      '2026-12-01T25:00',
      '',
    ])('rejects %p with 400', (bad) => {
      expect(() => localToUtc(bad, 'Africa/Cairo')).toThrow(
        BadRequestException,
      );
    });

    it('rejects an unknown time zone with 400', () => {
      expect(isValidTimeZone('Africa/Cairo')).toBe(true);
      expect(isValidTimeZone('Mars/Base')).toBe(false);
      expect(() => localToUtc('2026-12-01T10:00', 'Mars/Base')).toThrow(
        'Unknown time zone "Mars/Base"',
      );
    });
  });

  describe('toZonedTime', () => {
    it('gives UTC, local time, offset and zone for a flight response', () => {
      expect(toZonedTime('2026-12-01T12:30:00Z', 'Africa/Cairo')).toEqual({
        utc: '2026-12-01T12:30:00.000Z',
        local: '2026-12-01T14:30',
        utcOffset: '+02:00',
        timeZone: 'Africa/Cairo',
      });
    });
  });

  describe('localDayRangeUtc', () => {
    it('turns a Cairo date into its UTC window (FLT-11)', () => {
      const { start, end } = localDayRangeUtc('2026-12-02', 'Africa/Cairo');
      expect(start.toISOString()).toBe('2026-12-01T22:00:00.000Z');
      expect(end.toISOString()).toBe('2026-12-02T22:00:00.000Z');
      // A flight leaving 00:30 Cairo time on 2 Dec is inside the window.
      const departure = localToUtc('2026-12-02T00:30', 'Africa/Cairo');
      expect(departure >= start && departure < end).toBe(true);
    });

    it('is 23 hours long on the day Berlin moves its clocks forward', () => {
      const { start, end } = localDayRangeUtc('2026-03-29', 'Europe/Berlin');
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    });

    it('rejects a malformed date', () => {
      expect(() => localDayRangeUtc('02/12/2026', 'Africa/Cairo')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('localDate and localDaysUntil', () => {
    it('counts calendar days in the local date', () => {
      // 23:59 Cairo on 30 Nov to 00:30 Cairo on 3 Dec: 3 local days.
      const now = new Date('2026-11-30T21:59:00Z');
      const departure = new Date('2026-12-02T22:30:00Z');
      expect(localDate(now, 'Africa/Cairo')).toBe('2026-11-30');
      expect(localDate(departure, 'Africa/Cairo')).toBe('2026-12-03');
      expect(localDaysUntil(departure, 'Africa/Cairo', now)).toBe(3);
    });

    it('is 0 on the same day and negative after it', () => {
      const now = new Date('2026-12-01T08:00:00Z');
      expect(localDaysUntil('2026-12-01T18:00:00Z', 'Asia/Dubai', now)).toBe(0);
      expect(
        localDaysUntil('2026-11-29T10:00:00Z', 'Asia/Dubai', now),
      ).toBe(-2);
    });
  });
});
