import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { CreatePostDto } from './create-post.dto';
import { PostListQueryDto } from './post-list-query.dto';
import { UpdatePostDto } from './update-post.dto';

const pipe = createValidationPipe();
const body = (metatype: unknown, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: metatype as any });

async function errorsOf(metatype: unknown, value: unknown) {
  try {
    await body(metatype, value);
    return null;
  } catch (e) {
    return (e as BadRequestException).getResponse() as {
      details: Record<string, string[]>;
    };
  }
}

describe('post DTOs (BLG-01, BLG-08)', () => {
  it('trims title and body, lower-cases and de-duplicates tags', async () => {
    const dto = await body(CreatePostDto, {
      title: '  Paris  ',
      body: ' Text ',
      tags: ['Paris ', 'paris', 'Food'],
    });
    expect(dto).toMatchObject({
      title: 'Paris',
      body: 'Text',
      tags: ['paris', 'food'],
    });
  });

  it('requires a title and a body', async () => {
    const res = await errorsOf(CreatePostDto, { title: ' ', body: '' });
    expect(Object.keys(res!.details).sort()).toEqual(['body', 'title']);
  });

  it('allows at most 5 tags of at most 30 characters', async () => {
    const six = await errorsOf(CreatePostDto, {
      title: 'T',
      body: 'B',
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(six!.details.tags).toBeDefined();
    const long = await errorsOf(CreatePostDto, {
      title: 'T',
      body: 'B',
      tags: ['x'.repeat(31)],
    });
    expect(long!.details.tags).toBeDefined();
  });

  it('rejects image URLs in the body: images are uploaded (BLG-10)', async () => {
    const res = await errorsOf(CreatePostDto, {
      title: 'T',
      body: 'B',
      images: ['/api/uploads/someone-elses.jpg'],
    });
    expect(res!.details.images).toBeDefined();
  });

  it('accepts a partial update', async () => {
    await expect(body(UpdatePostDto, { status: 'Published' })).resolves.toEqual(
      {
        status: 'Published',
      },
    );
    expect(
      (await errorsOf(UpdatePostDto, { status: 'Live' }))!.details.status,
    ).toBeDefined();
  });

  it('accepts ?tag and ?search on the post list (BLG-02, BLG-09)', async () => {
    const q = await pipe.transform(
      { tag: ' Travel ', search: ' Paris ', page: '2' },
      { type: 'query', metatype: PostListQueryDto },
    );
    expect(q).toMatchObject({
      tag: 'travel',
      search: 'Paris',
      page: 2,
      limit: 10,
    });
  });
});
