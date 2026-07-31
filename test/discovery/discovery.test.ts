import { describe, expect, it } from 'vitest';
import { analyzeUI, discoverUI } from '../../src/discovery/index.js';

describe('deterministic UI discovery', () => {
  it('discovers search/form submit, select, button and navigation', () => {
    document.body.innerHTML = `
      <form role="search" aria-label="Product search"><input name="query"><button type="submit">Search</button></form>
      <form id="login"><input name="user"><button type="submit">Sign in</button></form>
      <select id="sort"><option value="new">Newest</option></select>
      <button id="menu">Menu</button><a href="/results">Results</a>`;
    const tools = discoverUI(document);
    expect(tools.some((tool) => tool.kind === 'form' && tool.name.startsWith('submit.'))).toBe(true);
    expect(tools.some((tool) => tool.name.startsWith('select.'))).toBe(true);
    expect(tools.some((tool) => tool.name.startsWith('click.'))).toBe(true);
    expect(tools.some((tool) => tool.kind === 'navigation')).toBe(true);
    expect(tools.find((tool) => tool.kind === 'form')?.targetUI?.selector).toBeTruthy();
  });

  it('compiles forms into one task-level tool with constraints and dominance diagnostics', async () => {
    document.body.innerHTML = `
      <form id="account-search" aria-label="Account search">
        <label for="email">Customer email</label>
        <input id="email" name="email" type="email" required maxlength="80"
          toolparamdescription="Email address to locate">
        <button type="submit">Find account</button>
      </form>`;
    const submitted: string[] = [];
    let submitterClicks = 0;
    document.querySelector('button')?.addEventListener('click', () => { submitterClicks += 1; });
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted.push((document.querySelector('#email') as HTMLInputElement).value);
      submitted.push((event as SubmitEvent).submitter?.textContent || '');
    });

    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual([
      'submit.account-search',
      'click.find-account',
    ]);
    expect(tools[0]?.description).toContain('Submits via "Find account"');
    expect(tools[0]?.inputSchema).toMatchObject({
      required: ['fields'],
      properties: {
        fields: {
          additionalProperties: false,
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'Email address to locate',
            },
          },
        },
      },
    });
    await expect(Promise.resolve(
      tools[0]?.handler({ fields: { email: 'agent@example.test' } }),
    )).resolves.toMatchObject({
      status: 'ok',
      result: { fields: 1, submitted: true },
    });
    expect(submitted).toEqual(['agent@example.test', 'Find account']);
    expect(submitterClicks).toBe(1);

    const graph = analyzeUI(document);
    expect(graph.nodes.filter((node) => node.selected).map((node) => node.name)).toEqual([
      'submit.account-search',
      'click.find-account',
    ]);
    expect(graph.nodes.filter((node) => node.exclusionReason === 'dominated')).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.relation === 'dominates')).toHaveLength(1);
  });

  it('deduplicates equivalent automatic controls and applies a deterministic catalog budget', () => {
    document.body.innerHTML = `
      <button data-webmcp-tool="always-present">Explicit</button>
      <button data-webmcp-equivalent="refresh">Refresh</button>
      <button data-webmcp-equivalent="refresh">Refresh</button>
      <button>Alpha</button><button>Beta</button><button>Gamma</button>`;
    const tools = discoverUI(document, { catalog: { maxTools: 2 } });
    expect(tools.map((tool) => tool.name)).toContain('always-present');
    expect(tools).toHaveLength(3);

    const graph = analyzeUI(document, { catalog: { maxTools: 2 } });
    expect(graph.nodes.filter((node) => node.exclusionReason === 'equivalent')).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.exclusionReason === 'catalog-budget')).toHaveLength(2);
    expect(graph.selectedToolNames).toEqual(tools.map((tool) => tool.name));
  });

  it('honors declared equivalence between explicit tools', () => {
    document.body.innerHTML = `
      <button data-webmcp-tool="refresh-primary" data-webmcp-equivalent="refresh">Refresh</button>
      <button data-webmcp-tool="refresh-secondary" data-webmcp-equivalent="refresh">Refresh</button>`;
    const tools = discoverUI(document);
    expect(tools).toHaveLength(1);
    expect(['refresh-primary', 'refresh-secondary']).toContain(tools[0]?.name);
    expect(analyzeUI(document).nodes.filter((node) => node.exclusionReason === 'equivalent')).toHaveLength(1);
  });

  it('keeps same-label controls distinct unless equivalence is explicitly declared', () => {
    document.body.innerHTML = `
      <button id="refresh-left">Refresh</button>
      <button id="refresh-right">Refresh</button>`;
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual([
      'click.refresh-left',
      'click.refresh-right',
    ]);
    expect(analyzeUI(document).nodes.every((node) => node.selected)).toBe(true);
  });

  it('does not let a form dominate fields it cannot represent', () => {
    document.body.innerHTML = `
      <form id="partial">
        <input name="represented" aria-label="Represented">
        <input aria-label="Ad hoc">
        <button type="submit">Submit</button>
      </form>`;
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual([
      'submit.partial',
      'fill.ad-hoc',
      'click.submit',
    ]);
    const graph = analyzeUI(document);
    expect(graph.nodes.find((node) => node.name === 'fill.represented')?.exclusionReason).toBe('dominated');
    expect(graph.nodes.find((node) => node.name === 'fill.ad-hoc')?.selected).toBe(true);
  });

  it('does not let a fill-only form capability dominate submit behavior', () => {
    document.body.innerHTML = `
      <form data-webmcp-tool="fill-profile" data-webmcp-action="fill">
        <input name="user"><button type="submit">Save</button>
      </form>`;
    expect(discoverUI(document).map((tool) => tool.name)).toEqual([
      'fill-profile',
      'fill.user',
      'click.save',
    ]);
  });

  it('does not let a non-form submit capability dominate associated fields', () => {
    document.body.innerHTML = `
      <form id="external-owner"></form>
      <section id="scope">
        <input form="external-owner" name="query">
        <button form="external-owner" data-webmcp-tool="submit-external" data-webmcp-action="submit">Go</button>
      </section>`;
    const scope = document.querySelector('#scope')!;
    expect(discoverUI(scope).map((tool) => tool.name)).toEqual([
      'fill.query',
      'submit-external',
    ]);
  });

  it('keeps ambiguous submitters and duplicate-named fields independently available', () => {
    document.body.innerHTML = `
      <form id="editor">
        <input name="title" aria-label="Title">
        <input name="tag" aria-label="First tag">
        <input name="tag" aria-label="Second tag">
        <button type="submit">Save</button>
        <button type="submit" formaction="/publish">Publish</button>
      </form>`;
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual([
      'submit.editor',
      'fill.title',
      'fill.first-tag',
      'fill.second-tag',
      'click.save',
      'click.publish',
    ]);
    expect(analyzeUI(document).nodes.every((node) => node.selected)).toBe(true);
  });

  it('does not expose submitter action URLs in tool descriptions', () => {
    document.body.innerHTML = `
      <form id="publish"><input name="title">
        <button type="submit" formaction="/publish?mode=preview#private" formmethod="post">Publish</button>
      </form>`;
    const description = discoverUI(document).find((tool) => tool.name === 'submit.publish')?.description;
    expect(description).toContain('method post');
    expect(description).not.toContain('/publish');
    expect(description).not.toContain('mode=preview');
  });

  it('propagates the unique submitter risk to the synthesized form tool', () => {
    document.body.innerHTML = `
      <form id="account"><input name="reason"><button type="submit">Delete account</button></form>`;
    const tools = discoverUI(document);
    expect(tools.find((tool) => tool.name === 'submit.account')?.risk).toEqual({
      level: 'high',
      requiresConfirmation: true,
    });
    expect(tools.find((tool) => tool.name === 'click.delete-account')?.risk).toEqual({
      level: 'high',
      requiresConfirmation: true,
    });
  });

  it('does not reuse non-unique control names as cross-form identities', () => {
    document.body.innerHTML = `
      <form id="first-form"><input name="query" aria-label="First query"></form>
      <form id="second-form"><input name="query" aria-label="Second query"></form>`;
    const graph = analyzeUI(document, { catalog: { dominance: false } });
    const fields = graph.nodes.filter((node) => node.kind === 'action');
    expect(fields.map((node) => node.name)).toEqual([
      'fill.first-query',
      'fill.second-query',
    ]);
    expect(new Set(fields.map((node) => node.id)).size).toBe(2);
  });

  it('does not let a disabled explicit form dominate an available associated field', () => {
    document.body.innerHTML = `
      <form id="blocked-owner" aria-disabled="true"
        data-webmcp-tool="blocked-form" data-webmcp-action="submit">
        <button type="submit">Submit</button>
      </form>
      <input form="blocked-owner" name="external">`;
    expect(discoverUI(document).map((tool) => tool.name)).toEqual([
      'blocked-form',
      'fill.external',
    ]);
  });

  it('accounts for image submitters before dominating form fields', () => {
    document.body.innerHTML = `
      <form id="image-actions">
        <input name="query">
        <button type="submit">Search</button>
        <input type="image" aria-label="Visual search" formaction="/visual">
      </form>`;
    expect(discoverUI(document).map((tool) => tool.name)).toEqual([
      'submit.image-actions',
      'fill.query',
      'click.search',
      'click.visual-search',
    ]);
  });

  it('accounts for image submitters inside a shadow-root form', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <form id="visual">
        <input name="query">
        <input type="image" aria-label="First visual">
        <input type="image" aria-label="Second visual">
      </form>`;
    document.body.append(host);
    expect(discoverUI(document).map((tool) => tool.name)).toEqual([
      'submit.visual',
      'fill.query',
      'click.first-visual',
      'click.second-visual',
    ]);
  });

  it('uses the actual form owner for externally associated fields', () => {
    document.body.innerHTML = `
      <form id="owned"><button type="submit">Search</button></form>
      <input form="owned" name="external" aria-label="External query">`;
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual(['submit.owned', 'click.search']);
    expect(tools[0]?.inputSchema).toMatchObject({
      properties: {
        fields: {
          properties: { external: { type: 'string' } },
        },
      },
    });
  });

  it('preserves exact field names consistently in schema and dominance', () => {
    document.body.innerHTML = `
      <form id="exact-names">
        <input name="x"><input name=" x ">
        <button type="submit">Save</button>
      </form>`;
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual(['submit.exact-names', 'click.save']);
    const fields = (tools[0]?.inputSchema.properties as {
      fields: { properties: Record<string, unknown> };
    }).fields.properties;
    expect(Object.keys(fields)).toEqual(['x', ' x ']);
  });

  it('scopes declared equivalence to the actual semantic owner', () => {
    document.body.innerHTML = `
      <section><button data-webmcp-equivalent="refresh">Refresh</button></section>
      <section><button data-webmcp-equivalent="refresh">Refresh</button></section>`;
    expect(discoverUI(document, { catalog: { dominance: false } }).filter(
      (tool) => tool.targetUI?.label === 'Refresh',
    )).toHaveLength(2);
  });

  it('scopes declared equivalence by associated form for external controls', () => {
    document.body.innerHTML = `
      <form id="left"></form><form id="right"></form>
      <button form="left" data-webmcp-equivalent="refresh">Refresh</button>
      <button form="right" data-webmcp-equivalent="refresh">Refresh</button>`;
    expect(discoverUI(document, { catalog: { dominance: false } }).filter(
      (tool) => tool.targetUI?.label === 'Refresh',
    )).toHaveLength(2);
  });

  it('compiles same-origin iframe form fields without relying on the parent realm', () => {
    document.body.innerHTML = '<iframe id="child"></iframe>';
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = `
      <form id="frame-search">
        <input name="query" required>
        <button type="submit">Search</button>
      </form>`;
    const tool = discoverUI(document).find((candidate) => candidate.name === 'submit.frame-search');
    expect(tool?.inputSchema).toMatchObject({
      properties: {
        fields: {
          properties: { query: { type: 'string' } },
        },
      },
    });
  });

  it('anchors compatible HTML patterns and omits incompatible Unicode-set syntax', () => {
    document.body.innerHTML = `
      <input id="pin" pattern="[0-9]{4}" required>
      <input id="set" pattern="[a&&b]">
      <input id="legacy" pattern="[a-z-]+">`;
    const tools = discoverUI(document);
    expect(tools.find((tool) => tool.name === 'fill.pin')?.inputSchema).toMatchObject({
      properties: { value: { pattern: '^(?:[0-9]{4})$' } },
    });
    expect(
      (tools.find((tool) => tool.name === 'fill.set')?.inputSchema.properties as {
        value: Record<string, unknown>;
      }).value,
    ).not.toHaveProperty('pattern');
    expect(
      (tools.find((tool) => tool.name === 'fill.legacy')?.inputSchema.properties as {
        value: Record<string, unknown>;
      }).value,
    ).not.toHaveProperty('pattern');
  });

  it('lets optional patterned controls use the valid empty value', () => {
    document.body.innerHTML = '<input id="optional-code" pattern="[A-Z]+">';
    const value = (discoverUI(document)[0]?.inputSchema.properties as {
      value: Record<string, unknown>;
    }).value;
    expect(value).not.toHaveProperty('pattern');
    expect(value).toMatchObject({
      anyOf: [{ const: '' }, { pattern: '^(?:[A-Z]+)$' }],
    });
  });

  it('translates compatible formats and omits HTML UTF-16 length constraints', () => {
    document.body.innerHTML = `
      <input id="email-list" type="email" multiple>
      <input id="homepage" type="url">
      <input id="code" minlength="2" maxlength="8">`;
    const tools = discoverUI(document);
    const valueSchema = (name: string): Record<string, unknown> => (
      (tools.find((tool) => tool.name === name)?.inputSchema.properties as {
        value: Record<string, unknown>;
      }).value
    );
    expect(valueSchema('fill.email-list')).not.toHaveProperty('format');
    expect(valueSchema('fill.homepage')).not.toHaveProperty('format');
    expect(valueSchema('fill.code')).not.toHaveProperty('minLength');
    expect(valueSchema('fill.code')).not.toHaveProperty('maxLength');
  });

  it('ignores malformed or inapplicable HTML string constraints', () => {
    document.body.innerHTML = `
      <input id="number" type="number" maxlength="2" pattern="[0-9]+">
      <input id="malformed" maxlength="2x">
      <textarea id="notes" pattern="[A-Z]+"></textarea>`;
    const tools = discoverUI(document);
    const valueSchema = (name: string): Record<string, unknown> => (
      (tools.find((tool) => tool.name === name)?.inputSchema.properties as {
        value: Record<string, unknown>;
      }).value
    );
    expect(valueSchema('fill.number')).not.toHaveProperty('maxLength');
    expect(valueSchema('fill.number')).not.toHaveProperty('pattern');
    expect(valueSchema('fill.malformed')).not.toHaveProperty('maxLength');
    expect(valueSchema('fill.notes')).not.toHaveProperty('pattern');
  });

  it('normalizes unknown input types to text before compiling constraints', () => {
    document.body.innerHTML = `
      <form id="unknown-type">
        <input name="value" type="not-a-real-type" required minlength="2">
        <button type="submit">Save</button>
      </form>`;
    expect(discoverUI(document)[0]?.inputSchema).toMatchObject({
      properties: {
        fields: {
          properties: { value: { minLength: 1 } },
        },
      },
    });
  });

  it('excludes options disabled by an optgroup from select enums', () => {
    document.body.innerHTML = `
      <select id="choices" required>
        <option value="">Choose</option>
        <option value="available">Available</option>
        <option value="available">Available duplicate</option>
        <optgroup label="Disabled" disabled>
          <option value="blocked">Blocked</option>
        </optgroup>
      </select>`;
    expect(discoverUI(document)[0]?.inputSchema).toMatchObject({
      properties: { value: { enum: ['available'] } },
    });
  });

  it('keeps form patches optional while constraining supplied required values', () => {
    document.body.innerHTML = `
      <form id="requirements">
        <input name="text" required>
        <input name="readonly" required readonly>
        <input name="range" type="range" required>
        <input name="color" type="color" required>
        <button type="submit">Save</button>
      </form>`;
    const schema = discoverUI(document).find(
      (tool) => tool.name === 'submit.requirements',
    )?.inputSchema;
    const fields = (schema?.properties as {
      fields: { properties: Record<string, Record<string, unknown>>; required?: string[] };
    }).fields;
    expect(fields.required).toBeUndefined();
    expect(fields.properties.text).toMatchObject({ minLength: 1 });
    expect(fields.properties.readonly).not.toHaveProperty('minLength');
    expect(fields.properties.range).not.toHaveProperty('minLength');
  });

  it('ignores effectively disabled submitters when deciding dominance', () => {
    document.body.innerHTML = `
      <form id="enabled-action">
        <input name="query">
        <fieldset disabled>
          <button type="submit">Disabled submit</button>
          <input type="image" aria-label="Disabled image">
        </fieldset>
        <button type="submit">Enabled submit</button>
      </form>`;
    expect(discoverUI(document).map((tool) => tool.name)).toEqual([
      'submit.enabled-action',
      'click.enabled-submit',
    ]);
  });

  it('resolves aria-labelledby inside an open shadow root', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <span id="shadow-label">Shadow action</span>
      <button aria-labelledby="shadow-label"></button>`;
    document.body.append(host);
    expect(discoverUI(document).find(
      (tool) => tool.targetUI?.label === 'Shadow action',
    )?.name).toBe('click.shadow-action');
  });

  it('prefers aria-labelledby over aria-label for the accessible tool name', () => {
    document.body.innerHTML = `
      <span id="authoritative">Authoritative action</span>
      <button aria-label="Fallback action" aria-labelledby="authoritative"></button>`;
    expect(discoverUI(document).find(
      (tool) => tool.targetUI?.label === 'Authoritative action',
    )?.name).toBe('click.authoritative-action');
  });

  it('resolves aria-labelledby under a detached element root', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <span id="detached-label">Detached action</span>
      <button aria-labelledby="detached-label"></button>`;
    expect(discoverUI(root).find(
      (tool) => tool.targetUI?.label === 'Detached action',
    )?.name).toBe('click.detached-action');
  });

  it('emits valid aggregate schemas for duplicate and prototype-like field names', () => {
    document.body.innerHTML = `
      <form id="schema">
        <input type="hidden" name="csrf" value="internal">
        <input name="tag" required><input name="tag" required>
        <input name="__proto__" required>
        <button type="submit">Save</button>
      </form>`;
    const schema = discoverUI(document).find((tool) => tool.name === 'submit.schema')?.inputSchema;
    const fields = (schema?.properties as { fields: {
      properties: Record<string, unknown>;
      required?: string[];
    } }).fields;
    expect(fields.required).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(fields.properties, '__proto__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(fields.properties, 'tag')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fields.properties, 'csrf')).toBe(false);
  });

  it('keeps semantic identity and names stable across label-only rerenders', () => {
    document.body.innerHTML = '<button id="stable-action">Before</button>';
    const before = analyzeUI(document).nodes[0]!;
    document.querySelector('button')!.textContent = 'After';
    const after = analyzeUI(document).nodes[0]!;
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('click.stable-action');
    expect(after.label).toBe('After');
  });

  it('keeps stable target identities independent from mutable owner labels and positions', () => {
    document.body.innerHTML = `
      <section aria-label="Before"><button id="anchored">Action</button></section>
      <form id="lookup" aria-label="Before"><input name="query"></form>`;
    const before = new Map(analyzeUI(document).nodes.map((node) => [node.name, node.id]));
    document.querySelector('section')?.setAttribute('aria-label', 'After');
    document.querySelector('form')?.setAttribute('aria-label', 'After');
    document.body.insertAdjacentHTML('afterbegin', '<section>Inserted sibling</section>');
    const after = new Map(analyzeUI(document).nodes.map((node) => [node.name, node.id]));
    expect(after.get('click.anchored')).toBe(before.get('click.anchored'));
    expect(after.get('submit.lookup')).toBe(before.get('submit.lookup'));
  });

  it('uses explicit metadata and collision-safe stable names', () => {
    document.body.innerHTML = '<button data-webmcp-tool="save">Save</button><button data-webmcp-tool="save">Save</button>';
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual(['save', 'save-2']);
    expect(tools[0].provenance).toMatchObject({ source: 'metadata', confidence: 1, sourceId: 'save' });
  });

  it('keeps explicit target selectors stable when sibling positions change', async () => {
    document.body.innerHTML = `
      <button data-webmcp-tool="first">First</button>
      <button data-webmcp-tool="stable">Stable</button>`;
    const before = discoverUI(document).find((tool) => tool.name === 'stable')!;
    expect(before.targetUI?.selector).toBe('[data-webmcp-tool="stable"]');

    document.querySelector('[data-webmcp-tool="first"]')?.remove();
    const after = discoverUI(document).find((tool) => tool.name === 'stable')!;
    expect(after.targetUI?.selector).toBe(before.targetUI?.selector);
    expect(await before.handler({})).toMatchObject({ status: 'ok', action: 'click' });
  });

  it('does not turn weak generic DOM patterns into mutating tools', () => {
    document.body.innerHTML = '<div class="btn">Looks like a button</div><div onclick="x()">No semantic role</div>';
    expect(discoverUI(document)).toHaveLength(0);
  });

  it('discovers repeated lists as read-only queries and semantic pagination as navigation', async () => {
    document.body.innerHTML = '<ul aria-label="Results"><li>One</li><li>Two</li></ul><nav><a rel="next" href="?page=2">Next</a></nav>';
    const tools = discoverUI(document);
    const list = tools.find((tool) => tool.kind === 'query');
    expect(list?.name).toBe('query.results');
    expect(await list?.handler({})).toEqual({
      status: 'ok',
      items: ['One', 'Two'],
      completeness: {
        expectedCount: null,
        collectedCount: 2,
        complete: true,
        source: 'scroll-exhausted',
        iterations: 0,
      },
    });
    const next = tools.find((tool) => tool.kind === 'navigation' && tool.targetUI?.label === 'Next');
    expect(next).toMatchObject({ risk: { level: 'medium', requiresConfirmation: true } });
  });

  it('discovers div-based offer lists and loads them until declared and collected counts match', async () => {
    document.body.innerHTML = `
      <section id="all-offers-display" role="dialog" aria-label="All offers">
        <h2>3 weitere Optionen</h2>
        <div id="offer-scroller">
          <div id="pinned-offer">
            <input type="submit" aria-label="In den Einkaufswagen vom Verkäufer Amazon und Preis 16,99 €">
          </div>
          <div id="offer-list" aria-label="Other offers">
            <div class="offer"><input type="submit" aria-label="In den Einkaufswagen vom Verkäufer Alpha und Preis 18,00 €"></div>
            <div class="offer"><input type="submit" aria-label="In den Einkaufswagen vom Verkäufer Beta und Preis 19,00 €"></div>
          </div>
        </div>
      </section>`;
    const scroller = document.querySelector('#offer-scroller') as HTMLElement;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => 200 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    scroller.scrollBy = () => {
      scroller.scrollTop = 100;
      const list = document.querySelector('#offer-list')!;
      if (list.children.length === 2) {
        const offer = document.createElement('div');
        offer.className = 'offer';
        offer.innerHTML = '<input type="submit" aria-label="In den Einkaufswagen vom Verkäufer Gamma und Preis 20,00 €">';
        list.append(offer);
      }
    };

    const tools = discoverUI(document, { repeatedLists: { settleMs: 0 } });
    const accessibleQueries = tools.filter((tool) => tool.metadata?.recordScope === 'accessible-offers');
    expect(accessibleQueries).toHaveLength(1);
    const query = accessibleQueries[0];
    expect(query).toMatchObject({
      kind: 'query',
      targetUI: { selector: '#all-offers-display' },
      metadata: {
        discovery: 'repeated-list',
        structured: true,
        lazyLoad: true,
        recordScope: 'accessible-offers',
      },
    });
    const result = await query?.handler({});
    expect(result).toMatchObject({
      status: 'ok',
      items: [
        { fields: { seller: 'Amazon', price: '16,99 €' } },
        { fields: { seller: 'Alpha', price: '18,00 €' } },
        { fields: { seller: 'Beta', price: '19,00 €' } },
        { fields: { seller: 'Gamma', price: '20,00 €' } },
      ],
      completeness: {
        expectedCount: 4,
        collectedCount: 4,
        complete: true,
        source: 'heading',
        iterations: 1,
      },
    });
  });

  it('classifies submit, button, reset and image inputs as clicks instead of fills', () => {
    document.body.innerHTML = `
      <input type="submit" aria-label="Add to cart">
      <input type="button" aria-label="Open chooser">
      <input type="reset" aria-label="Reset form">
      <input type="image" aria-label="Image action">
      <input type="text" aria-label="Search terms">`;
    const tools = discoverUI(document);
    for (const label of ['Add to cart', 'Open chooser', 'Reset form', 'Image action']) {
      expect(tools.find((tool) => tool.targetUI?.label === label)).toMatchObject({
        kind: 'action',
        inputSchema: { type: 'object' },
      });
      expect(tools.find((tool) => tool.targetUI?.label === label)?.name).toMatch(/^click\./);
    }
    expect(tools.find((tool) => tool.targetUI?.label === 'Search terms')?.name).toMatch(/^fill\./);
  });

  it('discovers choices and classifies common semantic UI patterns', async () => {
    document.body.innerHTML = `
      <label>Remember me <input id="remember" type="checkbox"></label>
      <button id="updates" role="switch" aria-checked="false">Product updates</button>
      <button role="tab">Details</button>
      <div role="menu"><button role="menuitem">Export</button></div>
      <select aria-label="Filter category"><option value="all">All</option></select>
      <button aria-label="Add to cart">Add</button>`;
    document.querySelector('#updates')?.addEventListener('click', (event) => {
      (event.currentTarget as Element).setAttribute('aria-checked', 'true');
    });
    const tools = discoverUI(document);
    const choice = tools.find((tool) => tool.targetUI?.label === 'Remember me');
    expect(choice).toMatchObject({
      name: 'toggle.remember',
      inputSchema: { required: ['checked'] },
      metadata: { discovery: 'semantic-control', pattern: 'choice' },
    });
    expect(await choice?.handler({ checked: true })).toMatchObject({ status: 'ok', result: { checked: true } });
    expect(tools.find((tool) => tool.targetUI?.label === 'Details')?.metadata?.pattern).toBe('tab');
    expect(tools.find((tool) => tool.targetUI?.label === 'Export')?.metadata?.pattern).toBe('menu');
    expect(tools.find((tool) => tool.targetUI?.label === 'Filter category')?.metadata?.pattern).toBe('filter');
    expect(tools.find((tool) => tool.targetUI?.label === 'Add to cart')).toMatchObject({
      risk: { level: 'medium', requiresConfirmation: true },
      metadata: { pattern: 'cart' },
    });
  });

  it('collapses repeated per-item controls into one indexed action tool', async () => {
    document.body.innerHTML = `
      <ul aria-label="Products">
        <li><span>Alpha</span><button>Add to cart</button></li>
        <li><span>Beta</span><button>Add to cart</button></li>
        <li><span>Gamma</span><button>Add to cart</button></li>
      </ul>`;
    const clicked: string[] = [];
    for (const button of Array.from(document.querySelectorAll('button'))) {
      button.addEventListener('click', () => clicked.push(button.closest('li')?.textContent || ''));
    }
    const tools = discoverUI(document);
    const grouped = tools.find((tool) => tool.metadata?.discovery === 'repeated-item-action');
    expect(grouped).toMatchObject({
      name: 'item.add-to-cart.products',
      kind: 'action',
      inputSchema: { required: ['index'] },
      risk: { level: 'medium', requiresConfirmation: true },
      metadata: {
        pattern: 'cart',
        recordQuery: 'query.products',
        indexBase: 0,
      },
    });
    expect(tools.filter((tool) => tool.name.startsWith('click.add-to-cart'))).toHaveLength(0);
    expect(await grouped?.handler({ index: 1 })).toMatchObject({ status: 'ok', action: 'click' });
    expect(clicked).toEqual(['BetaAdd to cart']);
    expect(await grouped?.handler({ index: 8 })).toMatchObject({ status: 'error', error: 'record-not-found' });
  });

  it('only treats same-document fragments as low-risk navigation and ignores javascript URLs', () => {
    document.body.innerHTML = '<a href="#section">In-page</a><a href="/logout">Logout</a><a href="https://external.test/">External</a><a href="javascript:alert(1)">Unsafe</a>';
    const tools = discoverUI(document).filter((tool) => tool.kind === 'navigation');
    expect(tools).toHaveLength(3);
    expect(tools.find((tool) => tool.targetUI?.label === 'In-page')?.risk).toEqual({ level: 'low' });
    expect(tools.find((tool) => tool.targetUI?.label === 'Logout')?.risk).toEqual({ level: 'medium', requiresConfirmation: true });
    expect(tools.find((tool) => tool.targetUI?.label === 'External')?.risk).toEqual({ level: 'medium', requiresConfirmation: true });
    expect(tools.some((tool) => tool.targetUI?.label === 'Unsafe')).toBe(false);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint !== true)).toBe(true);
  });

  it('filters hidden and sensitive controls unless explicit metadata keeps a blocked descriptor', async () => {
    document.body.innerHTML = `
      <input type="hidden" name="hidden"><input type="password" name="password">
      <input type="file" name="file"><input type="checkbox" name="check"><input type="radio" name="radio">
      <input aria-hidden="true" name="aria"><input disabled name="disabled"><input name="search">
      <input type="password" data-webmcp-tool="explicit-password" name="explicit-password">`;
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['fill.search', 'explicit-password']));
    expect(tools.map((tool) => tool.targetUI?.label)).not.toEqual(expect.arrayContaining(['password', 'file', 'check', 'radio', 'aria', 'disabled']));
    const explicit = tools.find((tool) => tool.name === 'explicit-password');
    expect(explicit?.handler({ value: 'secret' })).toMatchObject({ status: 'error', error: 'target-disabled' });
  });

  it('does not discover controls below hidden, aria-hidden, or inert ancestors', () => {
    document.body.innerHTML = `
      <div hidden><button data-webmcp-tool="hidden-button">Hidden</button></div>
      <div aria-hidden="true"><ul aria-label="Hidden list"><li>One</li><li>Two</li></ul></div>
      <div inert><button data-webmcp-tool="inert-button">Inert</button></div>
      <div style="display: none"><button data-webmcp-tool="css-hidden-button">CSS hidden</button></div>`;
    expect(discoverUI(document).map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(['hidden-button', 'query.hidden-list', 'inert-button', 'css-hidden-button']),
    );

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.attachShadow({ mode: 'open' }).innerHTML = '<button data-webmcp-tool="shadow-hidden">Shadow hidden</button>';
    document.body.append(host);
    expect(discoverUI(document).map((tool) => tool.name)).not.toContain('shadow-hidden');
  });

  it('resolves a replaced element at call time', async () => {
    document.body.innerHTML = '<button id="go">Go</button>';
    const tool = discoverUI(document).find((item) => item.targetUI?.selector === '#go')!;
    document.querySelector('#go')!.replaceWith(Object.assign(document.createElement('button'), { id: 'go' }));
    const result = await tool.handler({});
    expect(result).toMatchObject({ status: 'ok', action: 'click', selector: '#go' });
  });

  it('discovers open shadow roots and same-origin iframe roots supplied by traversal', () => {
    document.body.innerHTML = '<div id="host"></div><iframe id="frame"></iframe>';
    const host = document.querySelector('#host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<button data-webmcp-tool="shadowAction">Shadow</button>';
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = '<select data-webmcp-tool="frameSelect"><option value="x">X</option></select>';
    const tools = discoverUI(document);
    expect(tools.map((tool) => tool.name)).toContain('shadowaction');
    expect(tools.map((tool) => tool.name)).toContain('frameselect');
  });

  it('keeps identical stable selectors distinct across shadow-root trees', () => {
    for (let index = 0; index < 2; index += 1) {
      const host = document.createElement('div');
      host.id = `host-${index}`;
      host.attachShadow({ mode: 'open' }).innerHTML = '<button id="save">Save</button>';
      document.body.append(host);
    }
    const graph = analyzeUI(document);
    const saves = graph.nodes.filter((node) => node.name.startsWith('click.save'));
    expect(saves).toHaveLength(2);
    expect(saves.every((node) => node.selected)).toBe(true);
    expect(new Set(saves.map((node) => node.id)).size).toBe(2);
  });

  it('disambiguates direct ShadowRoot siblings and invokes each distinct target', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const first = document.createElement('button');
    first.dataset.webmcpTool = 'shadow-first';
    first.textContent = 'First';
    const second = document.createElement('button');
    second.dataset.webmcpTool = 'shadow-second';
    second.textContent = 'Second';
    const clicks: string[] = [];
    first.addEventListener('click', () => clicks.push('first'));
    second.addEventListener('click', () => clicks.push('second'));
    shadow.append(first, second);
    document.body.append(host);

    const tools = discoverUI(document);
    const firstTool = tools.find((tool) => tool.name === 'shadow-first')!;
    const secondTool = tools.find((tool) => tool.name === 'shadow-second')!;
    expect(firstTool.targetUI?.selector).toBe('[data-webmcp-tool="shadow-first"]');
    expect(secondTool.targetUI?.selector).toBe('[data-webmcp-tool="shadow-second"]');
    expect(await firstTool.handler({})).toMatchObject({ status: 'ok' });
    expect(await secondTool.handler({})).toMatchObject({ status: 'ok' });
    expect(clicks).toEqual(['first', 'second']);
  });

  it('uses a resolvable :scope selector when the discovery root is an element', async () => {
    const root = document.createElement('button');
    root.dataset.webmcpTool = 'root-button';
    root.textContent = 'Root';
    document.body.append(root);
    const tool = discoverUI(root).find((item) => item.name === 'root-button');
    expect(tool?.targetUI?.selector).toBe(':scope');
    expect(tool?.handler({})).toMatchObject({ status: 'ok', selector: ':scope' });
  });
});
