// Jest setupFiles: runs before each unit-test file is loaded.
// AppModule validates the environment as soon as it is imported, so unit
// tests get safe placeholder values. They never connect to this database:
// tests that boot AppModule replace the Mongoose connection.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unit-tests-never-connect';
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret-1234';
process.env.JWT_EXPIRES_IN = '15m';
process.env.FRONTEND_URL = 'http://localhost:3001';
