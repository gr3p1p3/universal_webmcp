import { describe, expect, it } from 'vitest';
import type { RuntimeMode } from '../src/index.js';

describe('project scaffold', () => {
  it('defines the planned runtime modes without implementing runtime behavior', () => {
    const mode: RuntimeMode = 'hybrid';

    expect(mode).toBe('hybrid');
    expect(document).toBeDefined();
  });
});
