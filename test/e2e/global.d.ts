import type { WebMCPRuntime } from '../../src/index.js';
import type * as WebMCP from '../../src/index.js';

declare global {
  interface Window {
    AgentReadyWebMCP: typeof WebMCP;
    webmcpE2ERuntime?: WebMCPRuntime;
  }
}

export {};
