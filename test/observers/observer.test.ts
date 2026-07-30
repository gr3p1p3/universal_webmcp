import { describe, expect, it, vi } from 'vitest';
import { DomObserver, RuntimeObserver } from '../../src/index.js';

describe('observers', () => {
  it('debounces DOM invalidation and can be stopped and restarted', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const observer = new DomObserver(document, callback, { debounceMs: 20 });
    observer.start();
    document.body.append(document.createElement('div'));
    document.body.append(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(19);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    observer.stop();
    document.body.append(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(30);
    expect(callback).toHaveBeenCalledTimes(1);
    observer.start();
    document.body.append(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(20);
    expect(callback).toHaveBeenCalledTimes(2);
    observer.stop();
    vi.useRealTimers();
  });

  it('observes navigation and removes listeners on stop', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const observer = new RuntimeObserver(document, callback, { debounceMs: 5 });
    observer.start();
    window.dispatchEvent(new Event('hashchange'));
    vi.advanceTimersByTime(5);
    expect(callback).toHaveBeenCalledTimes(1);
    observer.stop();
    window.dispatchEvent(new Event('hashchange'));
    vi.advanceTimersByTime(5);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('observes pushState and replaceState, preserves history behavior, and restores patches on stop', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const observer = new RuntimeObserver(document, callback, { debounceMs: 5 });
    observer.start();
    expect(window.history.pushState({}, '', '/push')).toBeUndefined();
    vi.advanceTimersByTime(5);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(window.history.replaceState({}, '', '/replace')).toBeUndefined();
    vi.advanceTimersByTime(5);
    expect(callback).toHaveBeenCalledTimes(2);
    observer.stop();
    expect(window.history.pushState).toBe(originalPushState);
    expect(window.history.replaceState).toBe(originalReplaceState);
    window.history.pushState({}, '', '/after-stop');
    vi.advanceTimersByTime(5);
    expect(callback).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('covers existing and dynamically added open shadow roots and same-origin frames, then cleans up', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const frame = document.createElement('iframe');
    document.body.append(host, frame);
    const frameDocument = frame.contentDocument!;
    const callback = vi.fn();
    const observer = new DomObserver(document, callback, { debounceMs: 0 });
    observer.start();

    shadow.append(document.createElement('button'));
    frameDocument.body.append(document.createElement('button'));
    const dynamicHost = document.createElement('div');
    const dynamicShadow = dynamicHost.attachShadow({ mode: 'open' });
    document.body.append(dynamicHost);
    dynamicShadow.append(document.createElement('button'));
    const dynamicFrame = document.createElement('iframe');
    document.body.append(dynamicFrame);
    dynamicFrame.contentDocument!.body.append(document.createElement('button'));

    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    const callsBeforeStop = callback.mock.calls.length;
    observer.stop();
    shadow.append(document.createElement('button'));
    dynamicShadow.append(document.createElement('button'));
    frameDocument.body.append(document.createElement('button'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callback).toHaveBeenCalledTimes(callsBeforeStop);
  });

  it('does not observe detached nested roots or create observers for ordinary descendants', async () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(document.createElement('button'));
    document.body.append(host);
    const callback = vi.fn();
    const observer = new DomObserver(document, callback, { debounceMs: 0 });
    observer.start();
    const observedRoots = (): number => (observer as unknown as { observers: Map<ParentNode, unknown> }).observers.size;
    expect(observedRoots()).toBe(2);

    const ordinary = document.createElement('section');
    ordinary.innerHTML = '<div><span></span></div>';
    document.body.append(ordinary);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    const callsBeforeDetach = callback.mock.calls.length;
    ordinary.querySelector('span')!.append(document.createElement('b'));
    await vi.waitFor(() => expect(callback.mock.calls.length).toBeGreaterThan(callsBeforeDetach));
    expect(observedRoots()).toBe(2);
    const callsBeforeDetachMutation = callback.mock.calls.length;
    host.remove();
    await vi.waitFor(() => expect(callback.mock.calls.length).toBeGreaterThan(callsBeforeDetachMutation));
    const callsAfterDetach = callback.mock.calls.length;
    expect(observedRoots()).toBe(1);
    shadow.append(document.createElement('button'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callback.mock.calls.length).toBe(callsAfterDetach);
    observer.stop();
  });

  it('is a no-op without MutationObserver or a browser window', () => {
    const original = globalThis.MutationObserver;
    // @ts-expect-error test-only environment override
    globalThis.MutationObserver = undefined;
    const callback = vi.fn();
    const observer = new RuntimeObserver(undefined, callback);
    expect(() => observer.start()).not.toThrow();
    expect(() => observer.stop()).not.toThrow();
    globalThis.MutationObserver = original;
  });
});
