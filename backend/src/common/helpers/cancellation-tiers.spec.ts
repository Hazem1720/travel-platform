import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { toFieldErrors } from '../pipes/validation.pipe';
import {
  CancellationPolicyDto,
  hasUniqueThresholds,
  refundAmount,
  refundPercent,
} from './cancellation-tiers';

// FLT-09 (also HTL-10, HTL-21, FLT-26, PAY-03).
describe('refundPercent', () => {
  const tiers = [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 0, refundPercent: 0 },
  ];

  it.each([
    [45, 100],
    [30, 100],
    [29, 50],
    [10, 50],
    [7, 50],
    [3, 0],
    [0, 0],
  ])('%i days remaining -> %i%%', (days, expected) => {
    expect(refundPercent(tiers, days)).toBe(expected);
  });

  it('does not depend on the order of the tiers', () => {
    expect(refundPercent([...tiers].reverse(), 10)).toBe(50);
  });

  it('is 0 when no tier applies', () => {
    expect(refundPercent([{ daysBefore: 7, refundPercent: 80 }], 3)).toBe(0);
  });

  it.each([[[]], [null], [undefined]])('is 0 with no tiers (%p)', (none) => {
    expect(refundPercent(none, 10)).toBe(0);
  });

  it('is 0 after the date has passed', () => {
    expect(refundPercent(tiers, -1)).toBe(0);
  });
});

describe('refundAmount', () => {
  it('applies the percentage to integer cents and rounds', () => {
    const tiers = [{ daysBefore: 7, refundPercent: 33.3 }];
    expect(refundAmount(10000, tiers, 10)).toBe(3330);
    expect(refundAmount(999, tiers, 10)).toBe(333);
    expect(refundAmount(10000, tiers, 1)).toBe(0);
  });
});

describe('hasUniqueThresholds', () => {
  it('detects a repeated daysBefore', () => {
    expect(
      hasUniqueThresholds([
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 7, refundPercent: 20 },
      ]),
    ).toBe(false);
    expect(hasUniqueThresholds([{ daysBefore: 7, refundPercent: 50 }])).toBe(
      true,
    );
  });
});

describe('CancellationPolicyDto', () => {
  const errorsFor = async (body: unknown) => {
    const dto = plainToInstance(CancellationPolicyDto, body);
    return toFieldErrors(await validate(dto));
  };

  it('accepts valid tiers and an empty list', async () => {
    expect(
      await errorsFor({
        tiers: [
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 0, refundPercent: 0 },
        ],
      }),
    ).toEqual({});
    expect(await errorsFor({ tiers: [] })).toEqual({});
  });

  it('rejects a duplicate daysBefore', async () => {
    const errors = await errorsFor({
      tiers: [
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 7, refundPercent: 20 },
      ],
    });
    expect(errors.tiers).toEqual([
      'Each tier must have a different daysBefore',
    ]);
  });

  it.each([101, -1])('rejects refundPercent %p', async (percent) => {
    const errors = await errorsFor({
      tiers: [{ daysBefore: 7, refundPercent: percent }],
    });
    expect(Object.keys(errors)).toEqual(['tiers.0.refundPercent']);
  });

  it.each([1.5, -1])('rejects daysBefore %p', async (daysBefore) => {
    const errors = await errorsFor({
      tiers: [{ daysBefore, refundPercent: 50 }],
    });
    expect(Object.keys(errors)).toEqual(['tiers.0.daysBefore']);
  });

  it('rejects a missing tiers list', async () => {
    expect(Object.keys(await errorsFor({}))).toEqual(['tiers']);
  });
});
