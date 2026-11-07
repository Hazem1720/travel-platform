import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { RegisterDto } from '../../auth/dto/register.dto';
import { UpdateProfileDto } from '../../users/dto/update-profile.dto';
import { PaginationQueryDto } from '../pagination/pagination-query.dto';
import { createValidationPipe } from './validation.pipe';

async function validate(metatype: any, value: unknown, type: 'body' | 'query' = 'body') {
  const pipe = createValidationPipe();
  const meta: ArgumentMetadata = { type, metatype };
  try {
    return { ok: true as const, value: await pipe.transform(value, meta) };
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return { ok: false as const, body: (e as BadRequestException).getResponse() as any };
  }
}

const validRegister = {
  name: 'Sara Ali',
  email: 'sara@example.com',
  password: 'Passw0rd1',
  acceptTerms: true,
};

describe('createValidationPipe (GEN-02)', () => {
  it('keys validation messages by field', async () => {
    const r = await validate(RegisterDto, { ...validRegister, email: 'nope', password: 'short' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.body.message).toBe('Validation failed');
    expect(Object.keys(r.body.details).sort()).toEqual(['email', 'password']);
    expect(r.body.details.email).toEqual(['email must be an email']);
  });

  it('rejects a whitespace-only name with 400 instead of a 500 from the schema (MI-3)', async () => {
    const r = await validate(RegisterDto, { ...validRegister, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.body.details)).toEqual(['name']);
  });

  it('trims names', async () => {
    const r = await validate(RegisterDto, { ...validRegister, name: '  Sara Ali  ' });
    expect(r.ok && r.value.name).toBe('Sara Ali');
  });

  it('reports unknown fields by name', async () => {
    const r = await validate(RegisterDto, { ...validRegister, role: 'admin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.details.role).toEqual(['property role should not exist']);
  });
});

describe('preferredCurrency (ACC-09, IM-10)', () => {
  it('accepts a supported currency', async () => {
    const r = await validate(UpdateProfileDto, { preferredCurrency: 'EGP' });
    expect(r.ok).toBe(true);
  });

  it('rejects a well-formed but unsupported currency', async () => {
    const r = await validate(UpdateProfileDto, { preferredCurrency: 'CHF' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.body.details.preferredCurrency[0]).toMatch(/must be one of: AED, EGP/);
    }
  });
});

describe('PaginationQueryDto (GEN-05, IM-11)', () => {
  it('defaults to a page size of 10', async () => {
    const r = await validate(PaginationQueryDto, {}, 'query');
    expect(r.ok && r.value).toMatchObject({ page: 1, limit: 10 });
  });

  it('allows a smaller page', async () => {
    const r = await validate(PaginationQueryDto, { limit: '5' }, 'query');
    expect(r.ok && r.value.limit).toBe(5);
  });

  it('rejects a page size above 10', async () => {
    const r = await validate(PaginationQueryDto, { limit: '11' }, 'query');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.details.limit).toEqual(['limit must not be greater than 10']);
  });
});
