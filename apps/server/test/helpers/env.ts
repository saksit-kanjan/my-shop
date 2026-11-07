// AppModule validates the environment when it is imported. The real database URL is set per test (see createServices).
process.env['DATABASE_URL'] ||= 'postgres://placeholder@localhost:5432/placeholder';
process.env['CODE_SECRET'] ||= 'test-secret';
