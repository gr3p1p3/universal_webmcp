import { describe, expect, it } from 'vitest';
import { discoverUI } from '../../src/discovery/index.js';

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
      name: 'toggle.remember-me',
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
