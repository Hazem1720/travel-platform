import { PASSWORD_REGEX } from './register.dto';

// ACC-01: at least 8 characters, including at least one letter and one digit.
describe('password rule (ACC-01)', () => {
  it.each(['Passw0rd', 'abcdefg1', '1234567a', 'pass word 9', 'Pässw0rd'])(
    'accepts %p',
    (pw) => expect(PASSWORD_REGEX.test(pw)).toBe(true),
  );

  it.each([
    ['too short', 'Pass1'],
    ['7 characters', 'Passw0r'],
    ['no digit', 'Password'],
    ['no letter', '12345678'],
    ['empty', ''],
  ])('rejects a password that is %s', (_why, pw) => {
    expect(PASSWORD_REGEX.test(pw)).toBe(false);
  });

  it('rejects more than 72 characters (bcrypt limit)', () => {
    expect(PASSWORD_REGEX.test('a1'.repeat(36))).toBe(true);
    expect(PASSWORD_REGEX.test('a1'.repeat(36) + 'x')).toBe(false);
  });
});
