import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      // Standalone test scripts (run with npx tsx, not vitest)
      // These have #!/usr/bin/env npx tsx shebang and custom test runners
      'src/tests/**',
      'src/services/consolidation.service.test.ts',
      'src/services/enhancedIntentClassifier.service.test.ts',
      'src/services/escalation.service.test.ts',
      'src/services/frustrationDetector.service.test.ts',
      'src/services/intentClassifier.service.test.ts',
      'src/services/memory.service.test.ts',
      'src/services/responseRouter.service.test.ts',
      'src/repositories/embedding.repository.test.ts',
      'src/repositories/memory.repository.test.ts',
      'src/repositories/queue.repository.test.ts',
      'tests/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/tests/',
        '**/*.test.ts',
        '**/*.config.ts',
      ],
    },
  },
});
