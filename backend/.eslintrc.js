module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      // test/E2E_PLAN.md section 4: the e2e tests cannot be made green the
      // easy way. No skipped or focused tests, every test asserts something,
      // and no matcher that accepts any value.
      files: ['test/**/*.ts'],
      plugins: ['jest'],
      rules: {
        'jest/no-disabled-tests': 'error',
        'jest/no-focused-tests': 'error',
        'jest/no-standalone-expect': 'error',
        'jest/expect-expect': [
          'error',
          // supertest's .expect(status) is an assertion too.
          { assertFunctionNames: ['expect', '**.expect'] },
        ],
        'no-restricted-properties': [
          'error',
          {
            object: 'expect',
            property: 'anything',
            message:
              'expect.anything() accepts any value; assert the real one.',
          },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "CallExpression[callee.object.name='expect'][callee.property.name='any'] > Identifier[name='Object']",
            message:
              'expect.any(Object) accepts any object; assert its fields.',
          },
        ],
      },
    },
  ],
};
