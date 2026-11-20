import { Types } from 'mongoose';
import { visibleTo } from './ownership';

describe('GEN-10: visibleTo (hidden content for its author and admins)', () => {
  const id = new Types.ObjectId().toHexString();

  it('visitors see only visible items', () => {
    expect(visibleTo(undefined, 'authorId')).toEqual({ hidden: { $ne: true } });
  });

  it('a logged-in user also sees their own hidden items', () => {
    expect(visibleTo({ id, role: 'user' }, 'userId')).toEqual({
      $or: [
        { hidden: { $ne: true } },
        { userId: { $in: [id, new Types.ObjectId(id)] } },
      ],
    });
  });

  it('an admin sees everything', () => {
    expect(visibleTo({ id, role: 'admin' }, 'authorId')).toEqual({});
  });
});
