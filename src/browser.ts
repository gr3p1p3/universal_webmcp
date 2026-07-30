import { createWebMCPRuntime } from './runtime/index.js';
import type { WebMCPRuntime } from './runtime/index.js';

export * from './index.js';

/** The runtime started by a script carrying `data-webmcp-auto`, if any. */
export const autoRuntime: WebMCPRuntime | undefined = (() => {
  if (typeof document === 'undefined') return undefined;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement) || !script.hasAttribute('data-webmcp-auto')) return undefined;
  return createWebMCPRuntime({ autoStart: true });
})();
