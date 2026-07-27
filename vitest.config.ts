import { defineConfig } from 'vitest/config'

// Vitest 4 removed `vitest.workspace.ts`; multi-package runs are configured with
// `test.projects` pointing at each package's own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/shared', 'apps/api', 'apps/web'],
  },
})
