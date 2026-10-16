import { BadRequestException } from '@nestjs/common';

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

// Turns "price:asc" into { price: 1 }. Only fields in `allowed` are accepted.
export function buildSort(
  sort: string | undefined,
  allowed: string[],
  fallback = 'createdAt:desc',
): Record<string, 1 | -1> {
  const [field, dir = 'asc'] = (sort ?? fallback).split(':');
  if (!allowed.includes(field) && field !== 'createdAt') {
    throw new BadRequestException(`Cannot sort by "${field}". Allowed: ${allowed.join(', ')}`);
  }
  if (dir !== 'asc' && dir !== 'desc') {
    throw new BadRequestException('Sort direction must be asc or desc');
  }
  return { [field]: dir === 'asc' ? 1 : -1 };
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}