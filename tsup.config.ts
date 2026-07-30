import { defineConfig } from 'tsup';

const shared = { clean: true, sourcemap: true, target: 'es2022' as const };

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts', browser: 'src/browser.ts' },
    format: ['esm'],
    dts: true,
  },
  {
    ...shared,
    entry: { browser: 'src/browser.ts' },
    format: ['iife'],
    globalName: 'AgentReadyWebMCP',
    dts: false,
    outExtension: () => ({ js: '.iife.js' }),
  },
]);
