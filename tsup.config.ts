import { defineConfig } from 'tsup';

const licenseBanner = `/*!
 * Universal WebMCP
 * Copyright (C) 2026 AgentReady
 * SPDX-License-Identifier: AGPL-3.0-only
 */`;

const shared = {
  banner: { js: licenseBanner },
  clean: true,
  sourcemap: true,
  target: 'es2022' as const,
};

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
