/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  globals: {},
  verbose: false,
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      moduleNameMapper: {
        "^~/(.*)$": "<rootDir>/src/$1",
      },
      setupFilesAfterEnv: ["./jest.setup.js"],
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
    },
  ],
};
