import { model, Types } from 'mongoose';
import { MAX_REVIEW_TEXT, Review, ReviewSchema } from './review.schema';

// HTL-23 (schema only), with the GEN-10 hidden flag.
describe('Review schema (HTL-23)', () => {
  const ReviewModel = model(Review.name + 'SchemaSpec', ReviewSchema);
  const valid = () => ({
    hotelId: new Types.ObjectId(),
    bookingId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    rating: 4,
  });
  const errorsOf = (doc: object) =>
    Object.keys(new ReviewModel(doc).validateSync()?.errors ?? {});

  it('accepts a rating without text, visible by default', () => {
    const review = new ReviewModel(valid());
    expect(review.validateSync()).toBeUndefined();
    expect(review.text).toBe('');
    expect(review.hidden).toBe(false);
  });

  it.each([1, 5])('accepts rating %p', (rating) => {
    expect(errorsOf({ ...valid(), rating })).toEqual([]);
  });

  it.each([0, 6, 2.5])('refuses rating %p', (rating) => {
    expect(errorsOf({ ...valid(), rating })).toEqual(['rating']);
  });

  it('keeps text up to 1000 characters, trimmed', () => {
    const review = new ReviewModel({
      ...valid(),
      text: `  ${'a'.repeat(MAX_REVIEW_TEXT)}  `,
    });
    expect(review.validateSync()).toBeUndefined();
    expect(review.text).toHaveLength(MAX_REVIEW_TEXT);
    expect(errorsOf({ ...valid(), text: 'a'.repeat(1001) })).toEqual(['text']);
  });

  it('needs the hotel, the reservation, the author and the rating', () => {
    expect(errorsOf({}).sort()).toEqual(
      ['bookingId', 'hotelId', 'rating', 'userId'].sort(),
    );
  });

  it('has one review per reservation and an index for newest visible first', () => {
    const indexes = ReviewSchema.indexes();
    expect(indexes).toContainEqual([
      { bookingId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(indexes.map(([fields]) => fields)).toContainEqual({
      hotelId: 1,
      hidden: 1,
      createdAt: -1,
    });
  });
});
