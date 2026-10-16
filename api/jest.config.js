const path = require('node:path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.(e2e-)?spec\\.tsx?$',
  transform: {
    // Catálogo (Preact) e os testes dele: JSX do Preact e DOM, com o tsconfig do storefront.
    '(storefront|test[\\\\/]storefront)[\\\\/].+\\.tsx?$': ['ts-jest', { tsconfig: path.join(__dirname, '..', 'storefront', 'tsconfig.jest.json') }],
    '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.json') }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  // Subir o app Nest com o cache do ts-jest frio passa de 5 s; o padrão derrubava o beforeAll
  // e deixava o app aberto, travando o Jest.
  testTimeout: 60_000,
  globalSetup: '<rootDir>/test/global-setup.mjs',
  globalTeardown: '<rootDir>/test/global-teardown.mjs',
};
