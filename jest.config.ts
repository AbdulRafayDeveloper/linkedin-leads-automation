import nextJest from 'next/jest.js';
import type { Config } from 'jest';

const createJestConfig = nextJest({ dir: './' });

const customJestConfig: Config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/components/**/*.tsx',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/__tests__/**',
  ],
};

export default createJestConfig(customJestConfig);
