module.exports = {
    transform: {
      '^.+\\.mjsx?$': 'babel-jest',
    },
    setupFiles: ['./jest.setup.mjs'],
    testMatch: ['**/*.test.mjs', '**/*.spec.mjs'],
    watch: false
  };
  