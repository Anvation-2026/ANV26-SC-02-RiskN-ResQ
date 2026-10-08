module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^expo-location$': '<rootDir>/__mocks__/expo-location.js',
  },
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          rootDir: '.',
          ignoreDeprecations: '6.0',
          jsx: 'react-jsx',
          allowJs: true,
        },
        diagnostics: false,
      },
    ],
  },
};
