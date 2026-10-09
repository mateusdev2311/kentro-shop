/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.(e2e-)?spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: require('node:path').join(__dirname, 'tsconfig.json') }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Subir o app Nest com o cache do ts-jest frio passa de 5 s; o padrão derrubava o beforeAll
  // e deixava o app aberto, travando o Jest.
  testTimeout: 60_000,
  globalSetup: '<rootDir>/test/global-setup.mjs',
  globalTeardown: '<rootDir>/test/global-teardown.mjs',
};
