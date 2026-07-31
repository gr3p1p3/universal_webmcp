"use strict";
var AgentReadyWebMCP = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    BrowserModelContextAdapter: () => BrowserModelContextAdapter,
    CapabilityRegistry: () => CapabilityRegistry,
    CapabilityValidationError: () => CapabilityValidationError,
    DomObserver: () => DomObserver,
    DuplicateCapabilityError: () => DuplicateCapabilityError,
    MissingCapabilityError: () => MissingCapabilityError,
    MockModelContextAdapter: () => MockModelContextAdapter,
    RiskPolicy: () => RiskPolicy,
    RuntimeDestroyedError: () => RuntimeDestroyedError,
    RuntimeObserver: () => RuntimeObserver,
    analyzeUI: () => analyzeUI,
    autoRuntime: () => autoRuntime,
    createEventInvalidationSource: () => createEventInvalidationSource,
    createManualMappingTool: () => createManualMappingTool,
    createWebMCPRuntime: () => createWebMCPRuntime,
    discoverUI: () => discoverUI,
    evaluateRuntimeTool: () => evaluateRuntimeTool,
    evaluateToolPolicy: () => evaluateToolPolicy,
    executeDomAction: () => executeDomAction,
    getModelContext: () => getModelContext,
    resolveDomTarget: () => resolveDomTarget
  });

  // src/core/errors.ts
  var CapabilityValidationError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "CapabilityValidationError";
    }
  };
  var DuplicateCapabilityError = class extends Error {
    constructor(name) {
      super(`Capability "${name}" is already registered.`);
      this.name = "DuplicateCapabilityError";
    }
  };
  var MissingCapabilityError = class extends Error {
    constructor(name) {
      super(`Capability "${name}" is not registered.`);
      this.name = "MissingCapabilityError";
    }
  };
  var RuntimeDestroyedError = class extends Error {
    constructor() {
      super("The WebMCP runtime has been destroyed and cannot be mutated.");
      this.name = "RuntimeDestroyedError";
    }
  };

  // src/core/registry.ts
  var namePattern = /^[A-Za-z0-9._-]{1,128}$/;
  function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function cloneJson(value) {
    if (Array.isArray(value)) return value.map(cloneJson);
    if (isJsonObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
    }
    return value;
  }
  function freezeJson(value) {
    if (Array.isArray(value)) value.forEach(freezeJson);
    else if (isJsonObject(value)) Object.values(value).forEach(freezeJson);
    Object.freeze(value);
    return value;
  }
  function validateTool(tool) {
    if (!tool.name.trim() || !namePattern.test(tool.name)) {
      throw new CapabilityValidationError(
        "Capability name must be 1-128 ASCII letters, digits, ., _, or -."
      );
    }
    if (tool.title !== void 0 && typeof tool.title !== "string") {
      throw new CapabilityValidationError("Capability title must be a string when provided.");
    }
    if (!tool.description.trim()) throw new CapabilityValidationError("Capability description cannot be empty.");
    if (!isJsonObject(tool.inputSchema)) throw new CapabilityValidationError("Capability inputSchema must be an object.");
    if (tool.outputSchema !== void 0 && !isJsonObject(tool.outputSchema)) {
      throw new CapabilityValidationError("Capability outputSchema must be an object when provided.");
    }
    if (!Number.isFinite(tool.provenance.confidence) || tool.provenance.confidence < 0 || tool.provenance.confidence > 1) {
      throw new CapabilityValidationError("Capability confidence must be a number between 0 and 1.");
    }
    if (tool.annotations !== void 0) {
      if (!isJsonObject(tool.annotations)) {
        throw new CapabilityValidationError("Capability annotations must be an object when provided.");
      }
      if (tool.annotations.readOnlyHint !== void 0 && typeof tool.annotations.readOnlyHint !== "boolean") {
        throw new CapabilityValidationError("Capability readOnlyHint must be a boolean when provided.");
      }
      if (tool.annotations.untrustedContentHint !== void 0 && typeof tool.annotations.untrustedContentHint !== "boolean") {
        throw new CapabilityValidationError("Capability untrustedContentHint must be a boolean when provided.");
      }
    }
  }
  function copyTool(tool) {
    const copy = {
      ...tool,
      inputSchema: cloneJson(tool.inputSchema),
      outputSchema: tool.outputSchema === void 0 ? void 0 : cloneJson(tool.outputSchema),
      risk: { ...tool.risk },
      provenance: { ...tool.provenance },
      targetUI: tool.targetUI === void 0 ? void 0 : { ...tool.targetUI },
      annotations: tool.annotations === void 0 ? void 0 : {
        ...tool.annotations.readOnlyHint === void 0 ? {} : { readOnlyHint: tool.annotations.readOnlyHint },
        ...tool.annotations.untrustedContentHint === void 0 ? {} : { untrustedContentHint: tool.annotations.untrustedContentHint }
      },
      metadata: tool.metadata === void 0 ? void 0 : cloneJson(tool.metadata)
    };
    freezeJson(copy.inputSchema);
    if (copy.outputSchema !== void 0) freezeJson(copy.outputSchema);
    Object.freeze(copy.risk);
    Object.freeze(copy.provenance);
    if (copy.targetUI !== void 0) Object.freeze(copy.targetUI);
    if (copy.annotations !== void 0) Object.freeze(copy.annotations);
    if (copy.metadata !== void 0) freezeJson(copy.metadata);
    return Object.freeze(copy);
  }
  var CapabilityRegistry = class {
    tools = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Set();
    version = 0;
    register(tool) {
      validateTool(tool);
      if (this.tools.has(tool.name)) throw new DuplicateCapabilityError(tool.name);
      const stored = copyTool(tool);
      this.tools.set(stored.name, stored);
      this.emit({ type: "register", name: stored.name, version: ++this.version });
      return stored;
    }
    unregister(name) {
      if (!this.tools.delete(name)) return false;
      this.emit({ type: "unregister", name, version: ++this.version });
      return true;
    }
    replace(tool) {
      validateTool(tool);
      if (!this.tools.has(tool.name)) throw new MissingCapabilityError(tool.name);
      const stored = copyTool(tool);
      this.tools.set(stored.name, stored);
      this.emit({ type: "replace", name: stored.name, version: ++this.version });
      return stored;
    }
    upsert(tool) {
      return this.tools.has(tool.name) ? this.replace(tool) : this.register(tool);
    }
    get(name) {
      return this.tools.get(name);
    }
    list() {
      return this.snapshot();
    }
    clear() {
      if (this.tools.size === 0) return;
      this.tools.clear();
      this.emit({ type: "clear", version: ++this.version });
    }
    snapshot() {
      return Object.freeze(Array.from(this.tools.values()));
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    emit(event) {
      for (const listener of this.listeners) listener(event);
    }
  };

  // src/dom/state.ts
  function isTrueAttribute(element, name) {
    return element.getAttribute(name)?.trim().toLowerCase() === "true";
  }
  function isDisabledProperty(element) {
    return "disabled" in element && element.disabled === true;
  }
  function isInertProperty(element) {
    return "inert" in element && element.inert === true;
  }
  function isCssHidden(element) {
    const view = element.ownerDocument?.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") return false;
    try {
      const style = view.getComputedStyle(element);
      return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden";
    } catch {
      return false;
    }
  }
  function composedParent(element) {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    if (root && typeof root === "object" && "host" in root) {
      const host = root.host;
      return host && typeof host === "object" && host.nodeType === 1 ? host : null;
    }
    return null;
  }
  function getEffectiveDomState(element) {
    let current = element;
    let hidden = false;
    let ariaHidden = false;
    let cssHidden = false;
    let inert = false;
    let ariaDisabled = false;
    let disabled = false;
    while (current) {
      hidden ||= current.hasAttribute("hidden");
      ariaHidden ||= isTrueAttribute(current, "aria-hidden");
      cssHidden ||= isCssHidden(current);
      inert ||= current.hasAttribute("inert") || isInertProperty(current);
      ariaDisabled ||= isTrueAttribute(current, "aria-disabled");
      disabled ||= isDisabledProperty(current) || current.tagName.toLowerCase() === "fieldset" && isDisabledProperty(current);
      current = composedParent(current);
    }
    return { hidden, ariaHidden, cssHidden, inert, ariaDisabled, disabled };
  }
  function isEffectivelyHidden(element) {
    const state = getEffectiveDomState(element);
    return state.hidden || state.ariaHidden || state.cssHidden || state.inert;
  }
  function isEffectivelyDisabled(element) {
    const state = getEffectiveDomState(element);
    return state.disabled || state.ariaDisabled || state.inert;
  }

  // src/dom/actions.ts
  function asString(value) {
    return typeof value === "string" ? value : void 0;
  }
  function describe(element) {
    return { tagName: element.tagName.toLowerCase(), id: element.id || null };
  }
  function isTag(element, tag) {
    return element.tagName.toLowerCase() === tag;
  }
  function isTextControl(element) {
    if (isTag(element, "textarea")) return true;
    if (!isTag(element, "input")) return false;
    return !["button", "submit", "reset", "image", "hidden", "password", "file", "checkbox", "radio"].includes(
      (element.type || "text").toLowerCase()
    );
  }
  function resolveDomTarget(root, selector) {
    if (selector === ":scope" && root.nodeType === 1) return root;
    try {
      const node = root.querySelector(selector);
      return node && node.nodeType === 1 ? node : null;
    } catch {
      return null;
    }
  }
  function isDisabledTarget(element, options = {}) {
    const state = getEffectiveDomState(element);
    if (state.hidden || state.ariaHidden || state.cssHidden || state.inert || state.ariaDisabled || state.disabled) return true;
    if (isTag(element, "input") && ["hidden", "password", "file"].includes(
      (element.type || "text").toLowerCase()
    )) return !(options.allowSensitiveFormFields === true && element.type.toLowerCase() === "password");
    return false;
  }
  function setInputValue(element, value) {
    const prototype = isTag(element, "textarea") ? Object.getPrototypeOf(element) : Object.getPrototypeOf(element);
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  function fillForm(form, input, options = {}) {
    const fields = input.fields;
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
      return { fields: 0, skipped: 0 };
    }
    let count = 0;
    let skipped = 0;
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value !== "string") {
        skipped += 1;
        continue;
      }
      const control = form.elements.namedItem(name);
      const candidate = control;
      const sensitivePassword = candidate !== null && isTag(candidate, "input") && candidate.type.toLowerCase() === "password" && options.allowSensitiveFormFields === true;
      if (candidate && candidate.nodeType === 1 && (isTextControl(candidate) || sensitivePassword) && !isDisabledTarget(candidate, options)) {
        setInputValue(candidate, value);
        count += 1;
      } else {
        skipped += 1;
      }
    }
    return { fields: count, skipped };
  }
  function enabledSubmitters(form) {
    const formControls = Array.from(form.elements).filter((control) => {
      if (!("tagName" in control) || control.nodeType !== 1) return false;
      const element = control;
      const tag = element.tagName.toLowerCase();
      return element.form === form && (tag === "button" && !["button", "reset"].includes(element.type) || tag === "input" && ["submit", "image"].includes(element.type));
    });
    const root = form.getRootNode();
    const imageControls = Array.from(
      root.querySelectorAll('input[type="image"]')
    ).filter((control) => control.form === form);
    return [.../* @__PURE__ */ new Set([...formControls, ...imageControls])].filter((control) => !isDisabledTarget(control));
  }
  function executeElementAction(target, selector, action, input = {}, options = {}) {
    if (isDisabledTarget(target, options)) return { status: "error", action, selector, error: "target-disabled" };
    try {
      switch (action) {
        case "fill": {
          if (isTag(target, "form")) {
            return { status: "ok", action, selector, result: fillForm(target, input, options) };
          }
          const sensitivePassword = isTag(target, "input") && target.type.toLowerCase() === "password" && options.allowSensitiveFormFields === true;
          if (!isTextControl(target) && !sensitivePassword) {
            return { status: "error", action, selector, error: "target-not-fillable" };
          }
          const value = asString(input.value);
          if (value === void 0) return { status: "error", action, selector, error: "value-must-be-string" };
          setInputValue(target, value);
          return { status: "ok", action, selector, result: { updated: true } };
        }
        case "select": {
          if (!isTag(target, "select")) {
            return { status: "error", action, selector, error: "target-not-select" };
          }
          const value = asString(input.value);
          if (value === void 0) return { status: "error", action, selector, error: "value-must-be-string" };
          const select = target;
          const option = Array.from(select.options).find((candidate) => candidate.value === value);
          if (!option) {
            return { status: "error", action, selector, error: "option-not-found" };
          }
          const optgroup = option.parentElement?.tagName.toLowerCase() === "optgroup" ? option.parentElement : null;
          if (option.disabled || option.getAttribute("aria-disabled") === "true" || optgroup?.disabled) {
            return { status: "error", action, selector, error: "option-disabled" };
          }
          select.value = value;
          target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          return { status: "ok", action, selector, result: { updated: true } };
        }
        case "toggle": {
          const checked = input.checked;
          if (typeof checked !== "boolean") {
            return { status: "error", action, selector, error: "checked-must-be-boolean" };
          }
          if (isTag(target, "input")) {
            const control = target;
            const type = control.type.toLowerCase();
            if (type !== "checkbox" && type !== "radio") {
              return { status: "error", action, selector, error: "target-not-toggle" };
            }
            if (type === "radio" && checked === false) {
              return { status: "error", action, selector, error: "radio-cannot-be-unchecked" };
            }
            if (control.checked !== checked) {
              control.checked = checked;
              control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
              control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            }
            return { status: "ok", action, selector, result: { checked: control.checked } };
          }
          const role = target.getAttribute("role");
          if (!["checkbox", "radio", "switch"].includes(role || "") || !target.hasAttribute("aria-checked")) {
            return { status: "error", action, selector, error: "target-not-toggle" };
          }
          const current = target.getAttribute("aria-checked") === "true";
          if (role === "radio" && checked === false) {
            return { status: "error", action, selector, error: "radio-cannot-be-unchecked" };
          }
          if (current !== checked) {
            if (typeof target.click !== "function") {
              return { status: "error", action, selector, error: "target-not-clickable" };
            }
            target.click();
          }
          return {
            status: "ok",
            action,
            selector,
            result: { checked: target.getAttribute("aria-checked") === "true" }
          };
        }
        case "click":
          if (typeof target.click !== "function") return { status: "error", action, selector, error: "target-not-clickable" };
          target.click();
          return { status: "ok", action, selector, result: describe(target) };
        case "submit": {
          const form = isTag(target, "form") ? target : target.closest("form");
          if (!form) return { status: "error", action, selector, error: "form-not-found" };
          const filled = fillForm(form, input, options);
          if (typeof form.requestSubmit === "function") {
            const submitters = enabledSubmitters(form);
            if (submitters.length === 1) submitters[0].click();
            else form.requestSubmit();
          } else form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
          return { status: "ok", action, selector, result: { ...filled, submitted: true } };
        }
      }
    } catch {
      return { status: "error", action, selector, error: "action-failed" };
    }
  }
  function executeDomAction(root, selector, action, input = {}, options = {}) {
    const target = resolveDomTarget(root, selector);
    if (!target) return { status: "error", action, selector, error: "target-not-found" };
    return executeElementAction(target, selector, action, input, options);
  }

  // src/discovery/repeated-lists.ts
  var listMarker = /(?:^|[-_\s])(list|results?|offers|items|products|options|angebote|ergebnisse)(?:$|[-_\s])/i;
  var pinnedMarker = /(?:^|[-_\s])(pinned|featured)[-_\s]?(offer|item|result)(?:$|[-_\s])/i;
  var countHeading = /(\d[\d.,]*)\s+(?:(weitere|other)\s+)?(?:option(?:en|s)?|angebot(?:e)?|offers?|items?|results?|ergebnisse?)/i;
  var accessibleOfferLabel = /(?:vom Verkäufer\s+.+?\s+und Preis\s+[\d.,]+\s*€|from seller\s+.+?\s+and price\s+€\s*[\d.,]+)/i;
  var cartAction = /(?:add|move)\s+(?:to\s+)?(?:cart|basket|bag)|(?:in den|zum)\s+(?:warenkorb|einkaufswagen)|buy now/i;
  function compactText(element) {
    return (element.textContent || "").trim().replace(/\s+/g, " ");
  }
  function markerText(element) {
    return [
      element.id,
      element.getAttribute("class") || "",
      element.getAttribute("role") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("data-testid") || ""
    ].join(" ");
  }
  function structuralMarkerText(element) {
    return [
      element.id,
      element.getAttribute("class") || "",
      element.getAttribute("role") || "",
      element.getAttribute("data-testid") || ""
    ].join(" ");
  }
  function stableClasses(element) {
    return Array.from(element.classList).filter((value) => !/(active|selected|hover|focus|loading|hidden|visible|expanded|collapsed)/i.test(value)).sort().join(".");
  }
  function fingerprint(element) {
    const id = element.id && !/\d{2,}/.test(element.id) ? element.id : "";
    return [
      element.tagName.toLowerCase(),
      element.getAttribute("role") || "",
      id,
      stableClasses(element)
    ].join("|");
  }
  function directChildren(element) {
    return Array.from(element.children).filter((child) => child.nodeType === 1);
  }
  function repeatedPattern(element, options) {
    const tag = element.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      const items = directChildren(element).filter((child) => child.tagName.toLowerCase() === "li");
      return items.length >= 2 ? { kind: "text", childTag: "li" } : void 0;
    }
    if (options.includeStructuralContainers === false) return void 0;
    const role = element.getAttribute("role") || "";
    const semantic = ["list", "listbox", "feed", "grid", "table"].includes(role) || listMarker.test(structuralMarkerText(element));
    if (!semantic) return void 0;
    const offerControls = Array.from(element.querySelectorAll("[aria-label]")).filter((control) => accessibleOfferLabel.test(control.getAttribute("aria-label") || ""));
    if (offerControls.length >= 2) return { kind: "structured", accessibleOffers: true };
    const children = directChildren(element);
    const roleItems = children.filter((child) => ["listitem", "option", "row", "article"].includes(child.getAttribute("role") || ""));
    if (roleItems.length >= 2) {
      return { kind: "structured", childRole: roleItems[0]?.getAttribute("role") || void 0 };
    }
    const groups = /* @__PURE__ */ new Map();
    for (const child of children) {
      const key = fingerprint(child);
      const group = groups.get(key) ?? [];
      group.push(child);
      groups.set(key, group);
    }
    const repeated = [...groups.entries()].filter(([, group]) => group.length >= 2).sort((left, right) => right[1].length - left[1].length)[0];
    return repeated ? { kind: "structured", fingerprint: repeated[0] } : void 0;
  }
  function recordsFor(element, pattern) {
    if (pattern.accessibleOffers) {
      const controls = Array.from(element.querySelectorAll("[aria-label]")).filter((control) => accessibleOfferLabel.test(control.getAttribute("aria-label") || ""));
      return uniqueElements(controls.map((control) => control.closest('[id*="offer" i], [class*="offer" i], [role="listitem"], article') || control));
    }
    const children = directChildren(element);
    if (pattern.childTag) return children.filter((child) => child.tagName.toLowerCase() === pattern.childTag);
    if (pattern.childRole) return children.filter((child) => child.getAttribute("role") === pattern.childRole);
    return children.filter((child) => fingerprint(child) === pattern.fingerprint);
  }
  function actionLabel(element) {
    return (element.getAttribute("aria-label") || element.getAttribute("title") || (element.textContent || "")).trim().replace(/\s+/g, " ").slice(0, 80);
  }
  function actionSlug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
  }
  function actionIntent(element) {
    const label = actionLabel(element);
    if (cartAction.test(label)) return { key: "cart:add", label: "Add to cart" };
    return { key: label.toLowerCase(), label };
  }
  function repeatedActionControls(record) {
    const candidates = [
      record,
      ...Array.from(record.querySelectorAll(
        'button, input[type="button"], input[type="submit"], input[type="image"], [role="button"]'
      ))
    ];
    return uniqueElements(candidates).filter((candidate) => candidate.matches('button, input[type="button"], input[type="submit"], input[type="image"], [role="button"]') && actionLabel(candidate).length > 0 && !isEffectivelyHidden(candidate) && !isEffectivelyDisabled(candidate));
  }
  function repeatedActionError(error, index) {
    return index === void 0 ? { status: "error", error } : { status: "error", error, index };
  }
  function closestCollectionScope(element) {
    return element.closest('[role="dialog"], dialog, section, main') || element.parentElement || element;
  }
  function pinnedRecords(element) {
    if (!/(offer|angebot)/i.test(markerText(element))) return [];
    const scope = closestCollectionScope(element);
    const candidates = Array.from(scope.querySelectorAll("*")).filter((candidate) => pinnedMarker.test(markerText(candidate)) && !!candidate.querySelector("input[aria-label], button[aria-label], [data-webmcp-field]"));
    return uniqueRecords(
      candidates.filter((candidate) => !candidates.some((parent) => parent !== candidate && parent.contains(candidate)))
    );
  }
  function uniqueElements(elements3) {
    return elements3.filter((element, index) => elements3.indexOf(element) === index);
  }
  function uniqueRecords(elements3) {
    const seen = /* @__PURE__ */ new Set();
    return uniqueElements(elements3).filter((element, index) => {
      const accessible = parseAccessibleOfferLabel(element);
      const key = accessible.seller && accessible.price ? `${accessible.seller.toLowerCase()}|${accessible.price.replace(/\s+/g, "")}` : `element:${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function attributeExpectedCount(element) {
    for (const name of ["data-webmcp-total-count", "data-total-count", "data-count"]) {
      const value = Number.parseInt(element.getAttribute(name) || "", 10);
      if (Number.isFinite(value) && value >= 0) return { value, source: "attribute", additional: false };
    }
    const ariaSizes = Array.from(element.querySelectorAll("[aria-setsize]")).map((item) => Number.parseInt(item.getAttribute("aria-setsize") || "", 10)).filter((value) => Number.isFinite(value) && value >= 0);
    if (ariaSizes.length > 0) return { value: Math.max(...ariaSizes), source: "aria-setsize", additional: false };
    return void 0;
  }
  function headingExpectedCount(element) {
    const scope = closestCollectionScope(element);
    for (const heading of Array.from(scope.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))) {
      const match = compactText(heading).match(countHeading);
      if (!match) continue;
      const value = Number.parseInt(match[1].replace(/[.,]/g, ""), 10);
      if (Number.isFinite(value)) return { value, source: "heading", additional: !!match[2] };
    }
    return void 0;
  }
  function expectedCount(element, pinnedCount) {
    const declared = attributeExpectedCount(element) ?? headingExpectedCount(element);
    if (!declared) return void 0;
    return {
      ...declared,
      value: declared.value + (declared.additional ? pinnedCount : 0)
    };
  }
  function fieldMarker(element) {
    return [
      element.getAttribute("data-webmcp-field") || "",
      element.id,
      element.getAttribute("class") || "",
      element.getAttribute("data-testid") || "",
      element.getAttribute("aria-label") || ""
    ].join(" ");
  }
  function firstField(record, include, exclude) {
    const candidates = [record, ...Array.from(record.querySelectorAll("*"))].filter((candidate) => {
      const marker = fieldMarker(candidate);
      return include.test(marker) && !(exclude?.test(marker) ?? false) && compactText(candidate).length > 0;
    });
    const smallest = candidates.sort((left, right) => compactText(left).length - compactText(right).length)[0];
    return smallest ? compactText(smallest) : void 0;
  }
  function parseAccessibleOfferLabel(record) {
    const labels = Array.from(record.querySelectorAll("[aria-label]")).map((element) => element.getAttribute("aria-label") || "");
    for (const label of labels) {
      const german = label.match(/vom Verkäufer\s+(.+?)\s+und Preis\s+([\d.,]+\s*€)/i);
      if (german) return { seller: german[1]?.trim(), price: german[2]?.trim() };
      const english = label.match(/from seller\s+(.+?)\s+and price\s+(€\s*[\d.,]+)/i);
      if (english) return { seller: english[1]?.trim(), price: english[2]?.replace(/\s+/g, "") };
    }
    return {};
  }
  function normalizeSeller(value) {
    return value?.replace(/^(?:sold by|seller|verkauf durch|verkäufer)\s*:?\s*/i, "").trim() || void 0;
  }
  function priceFrom(value) {
    return value?.match(/(?:€\s*[\d.,]+|[\d.,]+\s*€)/)?.[0]?.replace(/\s+/g, " ").trim();
  }
  function structuredRecord(record) {
    const accessible = parseAccessibleOfferLabel(record);
    const seller = normalizeSeller(
      firstField(record, /(?:sold.?by|seller|merchant|vendor|verk[aä]ufer|haendler|händler)/i) ?? accessible.seller
    );
    const price = priceFrom(firstField(record, /(?:price|preis)/i, /(?:shipping|delivery|versand)/i)) ?? accessible.price;
    const fields = {};
    if (seller) fields.seller = seller;
    if (price) fields.price = price;
    const explicitFields = Array.from(record.querySelectorAll("[data-webmcp-field]"));
    for (const field of explicitFields) {
      const name = field.getAttribute("data-webmcp-field")?.trim();
      const value = compactText(field);
      if (name && value) fields[name] = value;
    }
    return {
      text: compactText(record),
      fields
    };
  }
  function findScrollableAncestor(element, records = []) {
    const candidates = [];
    for (const origin of [element, ...records]) {
      let current = origin;
      while (current) {
        const candidate = current;
        if (candidate.scrollHeight > candidate.clientHeight + 1 && candidate.clientHeight > 0) candidates.push(candidate);
        if (current === element) break;
        current = current.parentElement;
      }
    }
    if (candidates.length === 0) {
      candidates.push(...Array.from(element.querySelectorAll("*")).map((candidate) => candidate).filter((candidate) => candidate.scrollHeight > candidate.clientHeight + 1 && candidate.clientHeight > 0));
    }
    return uniqueElements(candidates).sort((left, right) => {
      const leftNamed = /scroll|viewport/i.test(markerText(left)) ? 1 : 0;
      const rightNamed = /scroll|viewport/i.test(markerText(right)) ? 1 : 0;
      return rightNamed - leftNamed || right.scrollHeight - right.clientHeight - (left.scrollHeight - left.clientHeight);
    })[0];
  }
  function numberInput(input, name, fallback, maximum) {
    const value = input[name];
    return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.floor(value))) : fallback;
  }
  function booleanInput(input, name, fallback) {
    return typeof input[name] === "boolean" ? input[name] : fallback;
  }
  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function readAllRecords(root, selector, pattern, options, input) {
    let current = resolveDomTarget(root, selector);
    if (!current) return { status: "error", error: "target-not-found" };
    const loadAll = booleanInput(input, "loadAll", options.loadAllByDefault !== false);
    const maxIterations = numberInput(input, "maxIterations", options.maxLoadIterations ?? 30, 100);
    const settleMs = numberInput(input, "settleMs", options.settleMs ?? 350, 5e3);
    let iterations = 0;
    let stableAtEnd = 0;
    let exhausted = false;
    while (loadAll && iterations < maxIterations) {
      const pinned2 = pinnedRecords(current);
      const records2 = uniqueRecords([...pinned2, ...recordsFor(current, pattern)]);
      const expected2 = expectedCount(current, pinned2.length);
      if (expected2 && records2.length >= expected2.value) break;
      const scroller = findScrollableAncestor(current, records2);
      if (!scroller) {
        exhausted = true;
        break;
      }
      const before = { count: records2.length, top: scroller.scrollTop, height: scroller.scrollHeight };
      const increment = Math.max(300, scroller.clientHeight * 0.8);
      if (typeof scroller.scrollBy === "function") scroller.scrollBy({ top: increment, behavior: "auto" });
      else scroller.scrollTop += increment;
      scroller.dispatchEvent(new Event("scroll"));
      iterations += 1;
      if (settleMs > 0) await pause(settleMs);
      current = resolveDomTarget(root, selector);
      if (!current) return { status: "error", error: "target-not-found" };
      const afterRecords = uniqueRecords([...pinnedRecords(current), ...recordsFor(current, pattern)]);
      const afterScroller = findScrollableAncestor(current, afterRecords);
      if (!afterScroller) {
        exhausted = true;
        break;
      }
      const afterCount = afterRecords.length;
      const atEnd = afterScroller.scrollTop + afterScroller.clientHeight >= afterScroller.scrollHeight - 1;
      const unchanged = afterCount === before.count && afterScroller.scrollTop === before.top && afterScroller.scrollHeight === before.height;
      stableAtEnd = atEnd && unchanged ? stableAtEnd + 1 : 0;
      if (stableAtEnd >= 2 && !expectedCount(current, pinnedRecords(current).length)) {
        exhausted = true;
        break;
      }
    }
    const pinned = pinnedRecords(current);
    const records = uniqueRecords([...pinned, ...recordsFor(current, pattern)]);
    const expected = expectedCount(current, pinned.length);
    const complete = expected ? records.length === expected.value : exhausted || !findScrollableAncestor(current, records);
    const items = pattern.kind === "text" ? records.map((record) => compactText(record)) : records.map(structuredRecord);
    return {
      status: "ok",
      items,
      completeness: {
        expectedCount: expected?.value ?? null,
        collectedCount: records.length,
        complete,
        source: expected?.source ?? (complete ? "scroll-exhausted" : "unknown"),
        iterations
      }
    };
  }
  function createRepeatedListTool(context) {
    const options = context.options ?? {};
    const pattern = repeatedPattern(context.element, options);
    if (!pattern) return void 0;
    const structured = pattern.kind === "structured";
    return {
      name: context.name,
      description: `Read all repeated items from ${context.label || "list"} and report completeness`,
      kind: "query",
      inputSchema: {
        type: "object",
        properties: {
          loadAll: { type: "boolean", default: true },
          maxIterations: { type: "integer", minimum: 0, maximum: 100 },
          settleMs: { type: "integer", minimum: 0, maximum: 5e3 }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          items: { type: "array", items: structured ? { type: "object" } : { type: "string" } },
          completeness: {
            type: "object",
            properties: {
              expectedCount: { type: ["integer", "null"] },
              collectedCount: { type: "integer" },
              complete: { type: "boolean" },
              source: { type: "string" },
              iterations: { type: "integer" }
            }
          }
        }
      },
      annotations: { readOnlyHint: true },
      risk: { level: "low" },
      provenance: { source: "discovery", confidence: structured ? 0.8 : 0.85 },
      targetUI: { selector: context.selector, label: context.label },
      metadata: {
        discovery: "repeated-list",
        structured,
        lazyLoad: true,
        recordScope: pattern.accessibleOffers ? "accessible-offers" : "direct-children"
      },
      lifecycle: "active",
      status: "available",
      handler: (input) => readAllRecords(context.root, context.selector, pattern, options, input)
    };
  }
  function createRepeatedItemActionTools(context) {
    const options = context.options ?? {};
    const pattern = repeatedPattern(context.element, options);
    if (!pattern) return { tools: Object.freeze([]), controls: /* @__PURE__ */ new Set() };
    const records = uniqueRecords([
      ...pinnedRecords(context.element),
      ...recordsFor(context.element, pattern)
    ]);
    const groups = /* @__PURE__ */ new Map();
    records.forEach((record, recordIndex) => {
      for (const control of repeatedActionControls(record)) {
        const intent = actionIntent(control);
        const group = groups.get(intent.key) ?? {
          label: intent.label,
          controls: [],
          recordIndexes: /* @__PURE__ */ new Set()
        };
        group.controls.push(control);
        group.recordIndexes.add(recordIndex);
        groups.set(intent.key, group);
      }
    });
    const represented = /* @__PURE__ */ new Set();
    const tools = [];
    for (const [key, group] of groups) {
      if (group.recordIndexes.size < 2) continue;
      for (const control of group.controls) represented.add(control);
      const cart = cartAction.test(group.label);
      tools.push({
        name: `item.${actionSlug(group.label)}`,
        description: `${group.label} for one item from ${context.label || "the repeated list"}`,
        kind: "action",
        inputSchema: {
          type: "object",
          required: ["index"],
          properties: {
            index: { type: "integer", minimum: 0 }
          }
        },
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
            action: { type: "string" },
            selector: { type: "string" }
          }
        },
        risk: cart ? { level: "medium", requiresConfirmation: true } : { level: "low" },
        provenance: { source: "discovery", confidence: 0.9 },
        targetUI: { selector: context.selector, label: group.label },
        metadata: {
          discovery: "repeated-item-action",
          pattern: cart ? "cart" : "repeated-action",
          recordQuery: context.name,
          indexBase: 0
        },
        lifecycle: "active",
        status: "available",
        handler: (input) => {
          const index = input.index;
          if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
            return repeatedActionError("index-must-be-non-negative-integer");
          }
          const current = resolveDomTarget(context.root, context.selector);
          if (!current) return repeatedActionError("target-not-found");
          const currentRecords = uniqueRecords([
            ...pinnedRecords(current),
            ...recordsFor(current, pattern)
          ]);
          const record = currentRecords[index];
          if (!record) return repeatedActionError("record-not-found", index);
          const control = repeatedActionControls(record).find((candidate) => actionIntent(candidate).key === key);
          if (!control) return repeatedActionError("record-action-not-found", index);
          return executeElementAction(
            control,
            `${context.selector}::item(${index})::${actionSlug(group.label)}`,
            "click"
          );
        }
      });
    }
    return { tools: Object.freeze(tools), controls: represented };
  }

  // src/discovery/semantic-graph.ts
  function validateOptions(options) {
    const maxTools = options.maxTools ?? 64;
    const minimumConfidence = options.minimumConfidence ?? 0.8;
    if (!Number.isInteger(maxTools) || maxTools < 1) {
      throw new RangeError("catalog.maxTools must be a positive integer.");
    }
    if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
      throw new RangeError("catalog.minimumConfidence must be between 0 and 1.");
    }
    return { maxTools, minimumConfidence, dominance: options.dominance !== false };
  }
  function rank(left, right) {
    return right.priority - left.priority || right.tool.provenance.confidence - left.tool.provenance.confidence || left.id.localeCompare(right.id) || left.tool.name.localeCompare(right.tool.name);
  }
  function ownerForm(candidate) {
    if (candidate.element.tagName.toLowerCase() === "form") return candidate.element;
    if ("form" in candidate.element) {
      const form = candidate.element.form;
      if (form) return form;
    }
    return candidate.element.closest("form");
  }
  function isFormMemberDominated(owner, member) {
    if (owner === member || member.explicit || owner.tool.kind !== "form") return false;
    if (owner.element.tagName.toLowerCase() !== "form") return false;
    if (owner.action !== "submit") return false;
    if (isEffectivelyDisabled(owner.element)) return false;
    const form = ownerForm(owner);
    if (!form || ownerForm(member) !== form) return false;
    const formSubmitters = Array.from(form.elements).filter((control) => typeof control.getAttribute === "function").filter((control) => {
      const tag2 = control.tagName.toLowerCase();
      const type2 = (control.type || "").toLowerCase();
      return control.form === form && !isEffectivelyDisabled(control) && (tag2 === "button" && !["button", "reset"].includes(type2) || tag2 === "input" && ["submit", "image"].includes(type2));
    });
    const root = form.getRootNode();
    const imageSubmitters = Array.from(
      root.querySelectorAll('input[type="image"]')
    ).filter((control) => control.form === form && !isEffectivelyDisabled(control));
    const submitters = [.../* @__PURE__ */ new Set([...formSubmitters, ...imageSubmitters])];
    const tag = member.element.tagName.toLowerCase();
    const type = (member.element.getAttribute("type") || "text").toLowerCase();
    const fieldName = member.element.getAttribute("name") || "";
    const sameNamedControls = fieldName ? Array.from(form.elements).filter((control) => typeof control.getAttribute === "function" && control.getAttribute("name") === fieldName).length : 0;
    const representedTextControl = member.action === "fill" && submitters.length <= 1 && !!fieldName && sameNamedControls === 1 && (tag === "textarea" || tag === "input" && ![
      "button",
      "submit",
      "reset",
      "image",
      "hidden",
      "password",
      "file",
      "checkbox",
      "radio"
    ].includes(type));
    return representedTextControl;
  }
  function compileSemanticCandidates(candidates, options = {}) {
    const config = validateOptions(options);
    const exclusions = /* @__PURE__ */ new Map();
    const edges = [];
    const ranked = [...candidates].sort(rank);
    if (config.dominance) {
      const owners = ranked.filter((candidate) => candidate.tool.kind === "form");
      for (const owner of owners) {
        for (const member of candidates) {
          if (!isFormMemberDominated(owner, member)) continue;
          exclusions.set(member.id, "dominated");
          edges.push({ from: owner.id, to: member.id, relation: "dominates" });
          edges.push({ from: owner.id, to: member.id, relation: "owns" });
        }
      }
    }
    const representatives = /* @__PURE__ */ new Map();
    for (const candidate of ranked) {
      if (exclusions.has(candidate.id)) continue;
      const representative = representatives.get(candidate.capabilityKey);
      if (!representative) {
        representatives.set(candidate.capabilityKey, candidate);
        continue;
      }
      const declaredEquivalent = candidate.capabilityKey.startsWith("equivalent|");
      if (declaredEquivalent || !candidate.explicit) {
        exclusions.set(candidate.id, "equivalent");
        edges.push({ from: representative.id, to: candidate.id, relation: "equivalent" });
        continue;
      }
      representatives.set(candidate.capabilityKey, candidate);
    }
    for (const candidate of candidates) {
      if (candidate.explicit || exclusions.has(candidate.id)) continue;
      if (candidate.tool.provenance.confidence < config.minimumConfidence) {
        exclusions.set(candidate.id, "below-confidence");
      }
    }
    const automatic = ranked.filter((candidate) => !candidate.explicit && !exclusions.has(candidate.id));
    for (const candidate of automatic.slice(config.maxTools)) {
      exclusions.set(candidate.id, "catalog-budget");
    }
    const selectedIds = new Set(
      candidates.filter((candidate) => !exclusions.has(candidate.id)).map((candidate) => candidate.id)
    );
    const tools = candidates.filter((candidate) => selectedIds.has(candidate.id)).map((candidate) => candidate.tool);
    const nodes = candidates.map((candidate) => {
      const exclusionReason = exclusions.get(candidate.id);
      return Object.freeze({
        id: candidate.id,
        name: candidate.tool.name,
        label: candidate.tool.targetUI?.label,
        kind: candidate.tool.kind,
        action: candidate.action,
        pattern: candidate.pattern,
        rule: candidate.rule,
        priority: candidate.priority,
        confidence: candidate.tool.provenance.confidence,
        selected: !exclusionReason,
        ...exclusionReason ? { exclusionReason } : {}
      });
    });
    return {
      tools: Object.freeze(tools),
      graph: Object.freeze({
        nodes: Object.freeze(nodes),
        edges: Object.freeze(edges.map((edge) => Object.freeze(edge))),
        selectedToolNames: Object.freeze(tools.map((tool) => tool.name))
      })
    };
  }

  // src/discovery/index.ts
  function slug(value, fallback) {
    const result = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return result || fallback;
  }
  function escapeCss(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }
  function attributeSelector(name, value) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
    return `[${name}="${escaped}"]`;
  }
  function elements(root) {
    const own = root.nodeType === 1 ? [root] : [];
    try {
      return [...own, ...Array.from(root.querySelectorAll("*"))];
    } catch {
      return own;
    }
  }
  function selectorFor(root, element) {
    if (element === root) return ":scope";
    if (element.id) {
      const selector = `#${escapeCss(element.id)}`;
      try {
        if (root.querySelectorAll(selector).length === 1) return selector;
      } catch {
      }
    }
    for (const attribute of ["data-webmcp-tool", "data-webmcp-action", "name"]) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const selector = attributeSelector(attribute, value);
      try {
        if (root.querySelectorAll(selector).length === 1) return selector;
      } catch {
      }
    }
    const parts = [];
    let current = element;
    while (current && current !== root) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentNode;
      const siblings = parent && "children" in parent ? Array.from(parent.children).filter((item) => item.tagName === current.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      current = parent?.nodeType === 1 ? parent : null;
    }
    return parts.join(" > ");
  }
  function labelOf(element) {
    const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => elementByIdInTree(element, id)?.textContent?.trim()).filter((value) => !!value).join(" ");
    const aria = labelledBy || element.getAttribute("aria-label") || element.getAttribute("title");
    if (aria) return aria;
    if (["input", "textarea", "select"].includes(element.tagName.toLowerCase())) {
      const control = element;
      if (control.labels?.[0]?.textContent) return control.labels[0].textContent.trim();
      if (element.getAttribute("placeholder")) return element.getAttribute("placeholder");
      if ("name" in control && control.name) return control.name;
    }
    return (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  }
  function explicit(element) {
    return element.hasAttribute("data-webmcp-tool") || element.hasAttribute("data-webmcp-action");
  }
  function isJavaScriptAnchor(element) {
    return element.tagName.toLowerCase() === "a" && (element.getAttribute("href")?.trim().toLowerCase().startsWith("javascript:") ?? false);
  }
  function isSensitiveControl(element) {
    if (element.tagName.toLowerCase() !== "input") return false;
    return ["hidden", "password", "file"].includes(
      (element.getAttribute("type") || "text").toLowerCase()
    );
  }
  function isAutomaticallyExcluded(element) {
    return isEffectivelyDisabled(element) || isSensitiveControl(element);
  }
  function isSearch(form) {
    return form.getAttribute("role") === "search" || form.getAttribute("aria-label")?.toLowerCase().includes("search") === true || !!form.querySelector('input[type="search"]');
  }
  function actionFor(element) {
    const declared = element.getAttribute("data-webmcp-action");
    if (declared === "fill" || declared === "submit" || declared === "click" || declared === "select") return declared;
    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "click";
      if (type === "checkbox" || type === "radio") return "toggle";
      return "fill";
    }
    if (tag === "textarea") return "fill";
    if (tag === "select") return "select";
    if (tag === "form") return "submit";
    const role = element.getAttribute("role") || "";
    if (["checkbox", "radio", "switch"].includes(role)) return "toggle";
    if (tag === "button" || tag === "a" || ["button", "tab", "menuitem"].includes(role)) return "click";
    return void 0;
  }
  function kindFor(action, element) {
    if (action === "submit" || element.tagName.toLowerCase() === "form") return "form";
    if (element.tagName.toLowerCase() === "a" && element.hasAttribute("href")) return "navigation";
    return "action";
  }
  var cartPattern = /(?:add|move)\s+(?:to\s+)?(?:cart|basket|bag)|(?:in den|zum)\s+(?:warenkorb|einkaufswagen)|buy now|checkout|place order/i;
  var destructivePattern = /\b(?:delete|remove|destroy|erase|deactivate|close account|cancel subscription|löschen|entfernen)\b/i;
  function stricterRisk(left, right) {
    const order = ["low", "medium", "high", "critical"];
    const level = order.indexOf(left.level) >= order.indexOf(right.level) ? left.level : right.level;
    return left.requiresConfirmation || right.requiresConfirmation ? { level, requiresConfirmation: true } : { level };
  }
  function riskFor(action, element, label) {
    let risk;
    if (destructivePattern.test(label)) risk = { level: "high", requiresConfirmation: true };
    else if (cartPattern.test(label)) risk = { level: "medium", requiresConfirmation: true };
    else if (action === "click" && element.tagName.toLowerCase() === "a" && element.hasAttribute("href")) {
      const href = element.getAttribute("href")?.trim() || "";
      risk = href.startsWith("#") ? { level: "low" } : { level: "medium", requiresConfirmation: true };
    } else risk = { level: action === "submit" ? "medium" : "low" };
    if (action === "submit" && element.tagName.toLowerCase() === "form") {
      const submitters = enabledFormSubmitters(element);
      if (submitters.length === 1) {
        const submitter = submitters[0];
        risk = stricterRisk(risk, riskFor("click", submitter, labelOf(submitter)));
      }
    }
    return risk;
  }
  function inputSchemaFor(action, element) {
    if ((action === "fill" || action === "submit") && element.tagName.toLowerCase() === "form") {
      const properties = /* @__PURE__ */ Object.create(null);
      const form = element;
      const controls = Array.from(form.elements).filter(isElementNode);
      const nameCounts = /* @__PURE__ */ new Map();
      for (const control of controls) {
        const name = String(control.getAttribute("name") || "");
        if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      }
      for (const control of controls) {
        const name = String(control.getAttribute("name") || "");
        if (!name || nameCounts.get(name) !== 1 || isSensitiveControl(control) || isEffectivelyDisabled(control)) continue;
        const tag = control.tagName.toLowerCase();
        const type = (control.getAttribute("type") || "text").toLowerCase();
        if (tag !== "textarea" && tag !== "input") continue;
        if (["button", "submit", "reset", "image", "checkbox", "radio"].includes(type)) continue;
        const description = control.getAttribute("toolparamdescription") || labelOf(control);
        properties[name] = stringSchemaFor(control, description);
      }
      return {
        type: "object",
        required: ["fields"],
        properties: {
          fields: {
            type: "object",
            properties,
            additionalProperties: false
          }
        }
      };
    }
    if (action === "select") {
      const select = element.tagName.toLowerCase() === "select" ? element : void 0;
      const options = select ? [...new Set(Array.from(select.options).filter((option) => !option.disabled && !(option.parentElement?.tagName.toLowerCase() === "optgroup" && option.parentElement.disabled) && !(select.required && !select.multiple && option.value === "")).map((option) => option.value))] : [];
      return {
        type: "object",
        required: ["value"],
        properties: {
          value: {
            type: "string",
            ...options.length > 0 ? { enum: options } : {},
            ...labelOf(element) ? { description: labelOf(element) } : {}
          }
        }
      };
    }
    if (action === "toggle") return { type: "object", required: ["checked"], properties: { checked: { type: "boolean" } } };
    if (action === "fill") {
      const description = element.getAttribute("toolparamdescription") || labelOf(element);
      const property = stringSchemaFor(element, description);
      return { type: "object", required: ["value"], properties: { value: property } };
    }
    return { type: "object" };
  }
  function isValueMissingCapable(element) {
    if (!element.hasAttribute("required") || element.hasAttribute("readonly")) return false;
    if (element.tagName.toLowerCase() === "textarea") return true;
    if (element.tagName.toLowerCase() !== "input") return false;
    return [
      "text",
      "search",
      "url",
      "tel",
      "email",
      "date",
      "month",
      "week",
      "time",
      "datetime-local",
      "number"
    ].includes(normalizedInputType(element));
  }
  function stringSchemaFor(element, description) {
    const schema = { type: "string" };
    if (description) schema.description = description;
    const type = normalizedInputType(element);
    const constraints = {};
    if (type === "email" && !element.hasAttribute("multiple")) constraints.format = "email";
    const supportsPattern = element.tagName.toLowerCase() === "input" && ["text", "search", "url", "tel", "email"].includes(type);
    const required = isValueMissingCapable(element);
    if (required) constraints.minLength = 1;
    const pattern = supportsPattern ? jsonSchemaPattern(element.getAttribute("pattern")) : void 0;
    if (pattern) constraints.pattern = pattern;
    if (required) Object.assign(schema, constraints);
    else if (Object.keys(constraints).length > 0) schema.anyOf = [{ const: "" }, constraints];
    return schema;
  }
  function normalizedInputType(element) {
    if (element.tagName.toLowerCase() !== "input") return "";
    const value = element.type;
    return (value || "text").toLowerCase();
  }
  function isElementNode(value) {
    return !!value && typeof value === "object" && value.nodeType === 1 && typeof value.getAttribute === "function";
  }
  function jsonSchemaPattern(pattern) {
    if (pattern === null || /(?:&&|--|\\q\{)/.test(pattern)) return void 0;
    const anchored = `^(?:${pattern})$`;
    try {
      new RegExp(pattern, "v");
      new RegExp(anchored, "u");
      return anchored;
    } catch {
      return void 0;
    }
  }
  function elementByIdInTree(element, id) {
    const root = element.getRootNode();
    if (typeof root.getElementById === "function") return root.getElementById(id);
    if (root.nodeType === 1 && root.id === id) return root;
    try {
      return root.querySelector(attributeSelector("id", id));
    } catch {
      return null;
    }
  }
  function normalized(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }
  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function ownerIdentity(element) {
    const explicitScope = element.closest("[data-webmcp-scope]");
    const associatedForm = "form" in element ? element.form : null;
    const owner = explicitScope || associatedForm || element.closest(
      'form, dialog, [role="dialog"], [role="search"], main, nav, aside, section, article'
    );
    if (!owner) return treeIdentity(element.getRootNode());
    return [
      owner.tagName.toLowerCase(),
      owner.getAttribute("data-webmcp-scope") || "",
      owner.id || "",
      owner.getAttribute("role") || "",
      normalized(
        owner.getAttribute("aria-label") || owner.getAttribute("title") || owner.getAttribute("name") || ""
      ),
      structuralPath(owner)
    ].join(":");
  }
  function structuralPath(element) {
    const parts = [];
    let current = element;
    while (current) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${current.id}`);
        break;
      }
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === current.tagName) : [];
      if (siblings.length > 1) part += `:${siblings.indexOf(current) + 1}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return `${treeIdentity(element.getRootNode())}/${parts.join("/")}`;
  }
  function treeIdentity(root) {
    if ("host" in root && isElementNode(root.host)) {
      return `${structuralPath(root.host)}::shadow`;
    }
    if (root.nodeType === 9) {
      const frame = root.defaultView?.frameElement;
      return frame && isElementNode(frame) ? `${structuralPath(frame)}::frame` : "document";
    }
    if (root.nodeType === 1) {
      const element = root;
      return `detached:${element.tagName.toLowerCase()}:${element.id || ""}`;
    }
    return "tree";
  }
  function fieldSignature(element) {
    if (element.tagName.toLowerCase() !== "form") return "";
    return Array.from(element.elements).filter(isElementNode).map((control) => `${control.tagName.toLowerCase()}:${control.getAttribute("name") || ""}:${control.getAttribute("type") || ""}`).sort().join(",");
  }
  function semanticIdentity(element, action, pattern, label, selector) {
    const declared = element.getAttribute("data-webmcp-tool");
    const anchor = declared ? `declared:${normalized(declared)}` : element.id ? `id:${element.id}` : element.getAttribute("name") ? `name:${element.getAttribute("name")}` : `label:${normalized(label)}`;
    const stableName = !!element.getAttribute("name") && selector.startsWith("[name=");
    const stableAnchor = !!(declared || element.id || stableName) && !selector.includes(":nth-of-type");
    const signature = [
      treeIdentity(element.getRootNode()),
      action || "query",
      pattern,
      ...stableAnchor ? [] : [ownerIdentity(element)],
      anchor,
      fieldSignature(element),
      ...stableAnchor ? [] : [selector]
    ].join("|");
    const equivalence = element.getAttribute("data-webmcp-equivalent")?.trim();
    const key = equivalence ? ["equivalent", action || "query", pattern, ownerIdentity(element), normalized(equivalence)].join("|") : `${treeIdentity(element.getRootNode())}|${signature}|target:${selector}`;
    return { id: `ui-${stableHash(signature)}`, key };
  }
  function stableNameSeed(element, label, selector) {
    const declared = element.getAttribute("data-webmcp-tool");
    if (declared) return declared;
    if (element.id) return element.id;
    if (["input", "textarea", "select"].includes(element.tagName.toLowerCase())) {
      const name = element.getAttribute("name");
      if (name && selector.startsWith("[name=")) return name;
      if (label && normalized(label) !== normalized(name || "")) return label;
      const owner = "form" in element ? element.form : null;
      const ownerName = owner?.id || owner?.getAttribute("aria-label");
      if (name && ownerName) return `${ownerName}-${name}`;
    }
    return label;
  }
  function ruleFor(element, action, label) {
    if (explicit(element)) return { rule: "explicit-metadata", priority: 1e3 };
    if (element.tagName.toLowerCase() === "form") return { rule: "semantic-form", priority: 900 };
    if (element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby") || element.hasAttribute("role")) {
      return { rule: "aria-html", priority: 700 };
    }
    if (label) return { rule: "aria-html", priority: action === "submit" ? 720 : 650 };
    return { rule: "textual-heuristic", priority: 500 };
  }
  function enabledFormSubmitters(form) {
    const root = form.getRootNode();
    return Array.from(root.querySelectorAll(
      'button, input[type="submit"], input[type="image"]'
    )).filter((control) => {
      const tag = control.tagName.toLowerCase();
      return control.form === form && !isEffectivelyDisabled(control) && (tag !== "button" || !["button", "reset"].includes(control.type));
    });
  }
  function descriptionFor(element, action, label) {
    const base = element.getAttribute("data-webmcp-description") || `${action} ${label || element.tagName.toLowerCase()}`;
    if (action !== "submit" || element.tagName.toLowerCase() !== "form") return base;
    const submitters = enabledFormSubmitters(element);
    if (submitters.length !== 1) return base;
    const submitter = submitters[0];
    const submitterLabel = labelOf(submitter) || submitter.tagName.toLowerCase();
    const methodOverride = submitter.getAttribute("formmethod");
    const overrides = [
      methodOverride ? `method ${methodOverride}` : ""
    ].filter(Boolean).join(", ");
    return `${base}. Submits via "${submitterLabel}"${overrides ? ` (${overrides})` : ""}.`;
  }
  function semanticPatternFor(element, action, label) {
    const role = element.getAttribute("role") || "";
    const rel = element.getAttribute("rel") || "";
    if (cartPattern.test(label)) return "cart";
    if (role === "tab") return "tab";
    if (role === "menuitem" || element.closest('[role="menu"], menu')) return "menu";
    if (element.closest('[role="dialog"], dialog')) return "dialog";
    if (/(?:^|\s)(?:next|prev|previous)(?:\s|$)/i.test(rel) || /^(?:next|previous|prev|weiter|zurück)$/i.test(label.trim())) return "pagination";
    if (element.tagName.toLowerCase() === "form" && isSearch(element)) return "search";
    if (action === "select" || /\b(?:filter|sort|category|facet)\b/i.test(label)) return "filter";
    if (action === "toggle") return "choice";
    return "control";
  }
  function contexts(root, options) {
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    const visit = (current) => {
      if (seen.has(current)) return;
      seen.add(current);
      for (const element of elements(current)) {
        const selector = selectorFor(current, element);
        result.push({ root: current, selector, element });
        if (options.includeOpenShadowRoots !== false && element.shadowRoot) visit(element.shadowRoot);
        if (options.includeSameOriginFrames !== false && element.tagName.toLowerCase() === "iframe") {
          try {
            const frame = element;
            if (frame.contentDocument) visit(frame.contentDocument);
          } catch {
          }
        }
      }
    };
    visit(root);
    return result;
  }
  function discoverSemanticUI(root, options = {}) {
    const names = /* @__PURE__ */ new Set();
    const candidateIds = /* @__PURE__ */ new Set();
    const candidates = [];
    const coveredAccessibleOfferRegions = [];
    const coveredRepeatedActionControls = /* @__PURE__ */ new Set();
    const addCandidate = (tool, element, action, pattern, rule, priority, isExplicit, capabilityKey) => {
      const identity = semanticIdentity(
        element,
        action,
        pattern,
        tool.targetUI?.label || "",
        tool.targetUI?.selector || ""
      );
      let id = identity.id;
      let suffix = 2;
      while (candidateIds.has(id)) id = `${identity.id}-${suffix++}`;
      candidateIds.add(id);
      candidates.push({
        id,
        capabilityKey: capabilityKey || identity.key,
        element,
        action,
        pattern,
        rule,
        priority,
        explicit: isExplicit,
        tool: {
          ...tool,
          metadata: {
            ...tool.metadata ?? {},
            semanticId: id,
            semanticRule: rule,
            semanticPriority: priority
          }
        }
      });
    };
    for (const context of contexts(root, options)) {
      try {
        const { element } = context;
        if (isJavaScriptAnchor(element)) continue;
        if (isEffectivelyHidden(element)) continue;
        const isExplicit = explicit(element);
        if (!isExplicit && isAutomaticallyExcluded(element)) continue;
        const repeatedLabel = labelOf(element);
        {
          const base2 = `query.${slug(repeatedLabel, "list")}`;
          let name2 = base2;
          let suffix2 = 2;
          while (names.has(name2)) name2 = `${base2}-${suffix2++}`;
          const repeated = createRepeatedListTool({
            root: context.root,
            selector: context.selector,
            element,
            name: name2,
            label: repeatedLabel || void 0,
            options: options.repeatedLists
          });
          if (repeated) {
            const accessibleOffers = repeated.metadata?.recordScope === "accessible-offers";
            const covered = accessibleOffers && coveredAccessibleOfferRegions.some((region) => region.contains(element));
            if (!covered) {
              names.add(name2);
              addCandidate(
                repeated,
                element,
                void 0,
                String(repeated.metadata?.pattern || "repeated-list"),
                "repeated-structure",
                850,
                false
              );
              if (accessibleOffers) coveredAccessibleOfferRegions.push(element);
              const repeatedActions = createRepeatedItemActionTools({
                root: context.root,
                selector: context.selector,
                element,
                name: name2,
                label: repeatedLabel || void 0,
                options: options.repeatedLists
              });
              for (const control of repeatedActions.controls) coveredRepeatedActionControls.add(control);
              for (const groupedTool of repeatedActions.tools) {
                const groupedBase = `${groupedTool.name}.${slug(repeatedLabel, "list")}`;
                let groupedName = groupedBase;
                let groupedSuffix = 2;
                while (names.has(groupedName)) groupedName = `${groupedBase}-${groupedSuffix++}`;
                names.add(groupedName);
                addCandidate(
                  { ...groupedTool, name: groupedName },
                  element,
                  "click",
                  String(groupedTool.metadata?.pattern || "repeated-item-action"),
                  "repeated-structure",
                  840,
                  false,
                  `${identityKeyForRepeated(name2)}|${groupedTool.name}`
                );
              }
            }
          }
        }
        if (!isExplicit && coveredRepeatedActionControls.has(element)) continue;
        const action = actionFor(element);
        if (!action) continue;
        if (!isExplicit && element.tagName.toLowerCase() === "button" && element.getAttribute("type") === "button" && !labelOf(element)) continue;
        const label = labelOf(element);
        const declared = element.getAttribute("data-webmcp-tool");
        const base = declared ? slug(declared, "tool") : `${action}.${slug(
          stableNameSeed(element, label, context.selector),
          element.tagName.toLowerCase() === "form" && isSearch(element) ? "search" : element.tagName.toLowerCase()
        )}`;
        let name = base;
        let suffix = 2;
        while (names.has(name)) name = `${base}-${suffix++}`;
        names.add(name);
        const targetUI = { selector: context.selector, label: label || void 0, role: element.getAttribute("role") || void 0 };
        const provenance = isExplicit ? { source: "metadata", confidence: 1, sourceId: declared || element.getAttribute("data-webmcp-action") || void 0 } : { source: "discovery", confidence: element.tagName.toLowerCase() === "form" && isSearch(element) ? 0.95 : 0.9 };
        const semanticPattern = semanticPatternFor(element, action, label);
        const precedence = ruleFor(element, action, label);
        addCandidate({
          name,
          title: label || void 0,
          description: descriptionFor(element, action, label),
          kind: kindFor(action, element),
          inputSchema: inputSchemaFor(action, element),
          outputSchema: { type: "object", properties: { status: { type: "string" } } },
          ...kindFor(action, element) === "navigation" ? {} : { annotations: { readOnlyHint: false } },
          risk: riskFor(action, element, label),
          provenance,
          targetUI,
          metadata: { discovery: "semantic-control", pattern: semanticPattern },
          lifecycle: "active",
          status: "available",
          handler: (input) => executeDomAction(context.root, context.selector, action, input)
        }, element, action, semanticPattern, precedence.rule, precedence.priority, isExplicit);
      } catch {
      }
    }
    return compileSemanticCandidates(candidates, options.catalog);
  }
  function identityKeyForRepeated(name) {
    return `repeated:${name}`;
  }
  function analyzeUI(root, options = {}) {
    return discoverSemanticUI(root, options).graph;
  }
  function discoverUI(root, options = {}) {
    return discoverSemanticUI(root, options).tools;
  }

  // src/policy/index.ts
  var defaultConfirmationRisks = ["medium", "high"];
  var hybridSources = ["explicit", "manual", "adapter", "metadata", "discovery"];
  var autoSources = ["metadata", "discovery", "heuristic"];
  function reason(code, message) {
    return { code, message };
  }
  function isReadOnly(tool) {
    return tool.kind === "query" || tool.kind === "navigation";
  }
  function isWeakInferredSource(tool, minimumConfidence) {
    return (tool.provenance.source === "discovery" || tool.provenance.source === "heuristic") && tool.provenance.confidence < minimumConfidence;
  }
  function allowedSources(mode) {
    if (mode === "explicit") return ["explicit", "manual"];
    if (mode === "adapter") return ["adapter"];
    if (mode === "auto") return autoSources;
    return hybridSources;
  }
  function evaluateToolPolicy(tool, mode, config = {}) {
    const source = tool.provenance.source;
    const confidence = tool.provenance.confidence;
    const minimumConfidence = config.minimumConfidence ?? 0.8;
    const confirmationPolicy = config.confirmationPolicy ?? "risk-based";
    const confirmationRisks = config.confirmationRiskLevels ?? defaultConfirmationRisks;
    const reasons = [];
    if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
      throw new RangeError("minimumConfidence must be a number between 0 and 1.");
    }
    if (!allowedSources(mode).includes(source)) {
      reasons.push(reason(
        mode === "explicit" || mode === "adapter" ? "mode-source-mismatch" : "source-not-allowed",
        `Source "${source}" is not enabled in ${mode} mode.`
      ));
      return { decision: "deny", reasons, mode, source, confidence, risk: tool.risk.level };
    }
    if (tool.risk.level === "critical") {
      reasons.push(reason("critical-risk", "Critical-risk tools are never authorized automatically."));
      return { decision: "deny", reasons, mode, source, confidence, risk: tool.risk.level };
    }
    if (isWeakInferredSource(tool, minimumConfidence)) {
      reasons.push(reason("confidence-below-threshold", `Confidence ${confidence} is below ${minimumConfidence}.`));
      return { decision: "deny", reasons, mode, source, confidence, risk: tool.risk.level };
    }
    const inferred = source === "metadata" || source === "discovery" || source === "heuristic";
    const mutatingInferred = inferred && !isReadOnly(tool);
    if (mutatingInferred) {
      reasons.push(reason("mutating-inferred-tool", "Mutating tools inferred from metadata or heuristics require user confirmation."));
    }
    const requiresConfirmation = tool.risk.requiresConfirmation === true || mutatingInferred || confirmationPolicy === "always" || confirmationPolicy === "risk-based" && confirmationRisks.includes(tool.risk.level);
    if (requiresConfirmation) {
      reasons.push(reason("confirmation-required", "The configured risk policy requires user confirmation."));
      if (confirmationPolicy === "never") {
        if (mutatingInferred) {
          return { decision: "deny", reasons, mode, source, confidence, risk: tool.risk.level };
        }
        return { decision: "allow", reasons, mode, source, confidence, risk: tool.risk.level };
      }
      return { decision: "confirm", reasons, mode, source, confidence, risk: tool.risk.level };
    }
    reasons.push(reason(
      source === "explicit" || source === "manual" ? source === "manual" ? "allowed-manual" : "allowed-explicit" : source === "adapter" ? "allowed-adapter" : "allowed-inference",
      isReadOnly(tool) ? "Read-only tool meets the confidence threshold." : "Tool is allowed by the configured policy."
    ));
    return { decision: "allow", reasons, mode, source, confidence, risk: tool.risk.level };
  }
  var RiskPolicy = class {
    constructor(mode, config = {}) {
      this.mode = mode;
      this.config = config;
    }
    mode;
    config;
    evaluate(tool) {
      return evaluateToolPolicy(tool, this.mode, this.config);
    }
  };
  var evaluateRuntimeTool = evaluateToolPolicy;

  // src/platform/index.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function isBridge(value) {
    return isRecord(value) && typeof value.registerTool === "function";
  }
  function getModelContext() {
    if (typeof globalThis === "undefined") return null;
    const browserDocument = "document" in globalThis ? globalThis.document : void 0;
    if (isRecord(browserDocument) && isBridge(browserDocument.modelContext)) return browserDocument.modelContext;
    return null;
  }
  function isUntrustedOutput(tool) {
    return tool.provenance.source === "discovery" || tool.provenance.source === "heuristic" || tool.provenance.source === "imported";
  }
  function nativeTool(tool) {
    const title = tool.title ?? tool.targetUI?.label;
    return {
      name: tool.name,
      ...title ? { title } : {},
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (input) => {
        if (!isRecord(input) || Array.isArray(input)) {
          throw new TypeError("WebMCP tool input must be an object.");
        }
        return tool.handler(input);
      },
      annotations: {
        readOnlyHint: tool.annotations?.readOnlyHint ?? tool.kind === "query",
        untrustedContentHint: tool.annotations?.untrustedContentHint ?? isUntrustedOutput(tool)
      }
    };
  }
  var BrowserModelContextAdapter = class {
    constructor(context = getModelContext(), options = {}) {
      this.context = context;
      this.options = options;
    }
    context;
    options;
    controllers = /* @__PURE__ */ new Map();
    isAvailable() {
      return isBridge(this.context);
    }
    registerTool(tool) {
      if (!isBridge(this.context)) throw new Error("Model context is unavailable.");
      this.unregisterTool(tool.name);
      const controller = new AbortController();
      this.controllers.set(tool.name, controller);
      const ready = Promise.resolve(
        this.context.registerTool(nativeTool(tool), {
          signal: controller.signal,
          ...this.options.exposedTo === void 0 ? {} : { exposedTo: [...this.options.exposedTo] }
        })
      ).then(() => void 0).catch((error) => {
        if (controller.signal.aborted) return;
        if (this.controllers.get(tool.name) === controller) this.controllers.delete(tool.name);
        throw error;
      });
      return { name: tool.name, ready };
    }
    unregisterTool(name) {
      const controller = this.controllers.get(name);
      if (!controller) return;
      this.controllers.delete(name);
      controller.abort();
    }
    async requestUserInteraction(request) {
      if (!isBridge(this.context) || typeof this.context.requestUserInteraction !== "function") {
        throw new Error("Model context does not support user interaction.");
      }
      const result = await this.context.requestUserInteraction(request);
      return isRecord(result) ? result : { result };
    }
  };
  var MockModelContextAdapter = class {
    registrations = /* @__PURE__ */ new Map();
    interactions = [];
    interactionResult = { confirmed: true };
    isAvailable() {
      return true;
    }
    registerTool(tool) {
      const handle = { name: tool.name };
      this.registrations.set(tool.name, handle);
      return handle;
    }
    unregisterTool(name) {
      this.registrations.delete(name);
    }
    async requestUserInteraction(request) {
      this.interactions.push(request);
      return this.interactionResult;
    }
    registeredTools() {
      return [...this.registrations.values()];
    }
  };

  // src/observers/index.ts
  var semanticAttributes = [
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "aria-hidden",
    "aria-selected",
    "aria-expanded",
    "aria-checked",
    "aria-pressed",
    "aria-current",
    "aria-busy",
    "aria-setsize",
    "role",
    "title",
    "name",
    "type",
    "value",
    "placeholder",
    "checked",
    "disabled",
    "hidden",
    "inert",
    "href",
    "rel",
    "id",
    "class",
    "style",
    "data-testid",
    "data-webmcp-tool",
    "data-webmcp-action",
    "data-webmcp-description",
    "data-webmcp-total-count",
    "data-webmcp-busy",
    "data-total-count",
    "data-count"
  ];
  function createEventInvalidationSource(target, eventNames = ["webmcp:invalidate"]) {
    const names = [...new Set(eventNames.map((name) => name.trim()).filter(Boolean))];
    return {
      subscribe(callback) {
        for (const name of names) target.addEventListener(name, callback);
        return () => {
          for (const name of names) target.removeEventListener(name, callback);
        };
      }
    };
  }
  function schedule(callback, delay) {
    let timer;
    const invoke = function() {
      if (timer !== void 0) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = void 0;
        callback();
      }, delay);
    };
    invoke.cancel = () => {
      if (timer !== void 0) clearTimeout(timer);
      timer = void 0;
    };
    return invoke;
  }
  function resolveWindow(root) {
    const document2 = root.nodeType === 9 ? root : root.ownerDocument;
    const view = document2?.defaultView;
    return view && typeof view.addEventListener === "function" && view.history ? view : void 0;
  }
  function elements2(root) {
    const own = root.nodeType === 1 ? [root] : [];
    try {
      return [...own, ...Array.from(root.querySelectorAll("*"))];
    } catch {
      return own;
    }
  }
  function nestedRoots(root) {
    const result = [];
    for (const element of elements2(root)) {
      if (element.shadowRoot) result.push(element.shadowRoot);
      if (element.tagName.toLowerCase() === "iframe") {
        try {
          const frame = element;
          if (frame.contentDocument) result.push(frame.contentDocument);
        } catch {
        }
      }
    }
    return result;
  }
  var DomObserver = class {
    constructor(root, callback, options = {}) {
      this.root = root;
      this.debounceNotify = schedule(callback, Math.max(0, options.debounceMs ?? options.debounce ?? 50));
      this.attributeOptions = options;
    }
    root;
    observers = /* @__PURE__ */ new Map();
    frameLoadListeners = /* @__PURE__ */ new Map();
    debounceNotify;
    attributeOptions;
    running = false;
    observeRoot(root) {
      if (!this.running || this.observers.has(root) || typeof MutationObserver === "undefined") return;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (node.nodeType === 1) this.attachNested(node);
          }
        }
        this.reconcileNestedRoots();
        this.debounceNotify();
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: this.attributeOptions.observeAttributes !== false,
        attributeFilter: this.attributeOptions.observeAttributes === false ? void 0 : [...this.attributeOptions.attributeFilter ?? semanticAttributes]
      });
      this.observers.set(root, observer);
    }
    attachFrameListener(element) {
      if (this.frameLoadListeners.has(element)) return;
      const listener = () => {
        try {
          if (element.contentDocument) this.attachRootTree(element.contentDocument);
        } catch {
        }
        this.debounceNotify();
      };
      element.addEventListener("load", listener);
      this.frameLoadListeners.set(element, listener);
    }
    attachNested(element) {
      if (element.tagName.toLowerCase() === "iframe") this.attachFrameListener(element);
      for (const nested of nestedRoots(element)) this.attachRootTree(nested);
    }
    attachRootTree(root) {
      if (!this.running) return;
      this.observeRoot(root);
      for (const nested of nestedRoots(root)) this.attachRootTree(nested);
    }
    reachableNestedRoots() {
      const reachable = /* @__PURE__ */ new Set();
      const visit = (root) => {
        for (const nested of nestedRoots(root)) {
          if (reachable.has(nested)) continue;
          reachable.add(nested);
          visit(nested);
        }
      };
      if (this.root) visit(this.root);
      return reachable;
    }
    reconcileNestedRoots() {
      if (!this.running || !this.root) return;
      const reachable = this.reachableNestedRoots();
      for (const nested of reachable) this.attachRootTree(nested);
      for (const [observedRoot, observer] of this.observers) {
        if (observedRoot === this.root || reachable.has(observedRoot)) continue;
        observer.disconnect();
        this.observers.delete(observedRoot);
      }
      const reachableFrames = /* @__PURE__ */ new Set();
      const roots = [this.root, ...reachable];
      for (const root of roots) {
        for (const element of elements2(root)) {
          if (element.tagName.toLowerCase() === "iframe") {
            const frame = element;
            reachableFrames.add(frame);
            this.attachFrameListener(frame);
          }
        }
      }
      for (const [frame, listener] of this.frameLoadListeners) {
        if (reachableFrames.has(frame)) continue;
        frame.removeEventListener("load", listener);
        this.frameLoadListeners.delete(frame);
      }
    }
    start() {
      if (this.running || !this.root || typeof MutationObserver === "undefined") return;
      this.running = true;
      this.attachRootTree(this.root);
      this.reconcileNestedRoots();
    }
    stop() {
      if (!this.running && this.observers.size === 0) return;
      for (const observer of this.observers.values()) observer.disconnect();
      this.observers.clear();
      for (const [frame, listener] of this.frameLoadListeners) frame.removeEventListener("load", listener);
      this.frameLoadListeners.clear();
      this.debounceNotify.cancel();
      this.running = false;
    }
  };
  var historyPatches = /* @__PURE__ */ new WeakMap();
  function addHistoryListener(view, listener) {
    const history = view.history;
    let patch = historyPatches.get(history);
    if (!patch) {
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
      const listeners = /* @__PURE__ */ new Set();
      patch = { originalPushState, originalReplaceState, listeners };
      const notify = () => {
        for (const callback of listeners) {
          try {
            callback();
          } catch {
          }
        }
      };
      try {
        history.pushState = function(...args) {
          const result = originalPushState.apply(this, args);
          notify();
          return result;
        };
        history.replaceState = function(...args) {
          const result = originalReplaceState.apply(this, args);
          notify();
          return result;
        };
        historyPatches.set(history, patch);
      } catch {
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
        return void 0;
      }
    }
    patch.listeners.add(listener);
    return () => {
      const current = historyPatches.get(history);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size !== 0) return;
      history.pushState = current.originalPushState;
      history.replaceState = current.originalReplaceState;
      historyPatches.delete(history);
    };
  }
  var RuntimeObserver = class {
    dom;
    window;
    onNavigation;
    navigationNotify;
    observeNavigation;
    removeHistoryListener;
    running = false;
    constructor(root, callback, options = {}) {
      this.dom = new DomObserver(root, callback, options);
      this.window = root ? resolveWindow(root) : void 0;
      this.navigationNotify = schedule(callback, Math.max(0, options.debounceMs ?? options.debounce ?? 50));
      this.onNavigation = () => this.navigationNotify();
      this.observeNavigation = options.observeNavigation !== false;
    }
    start() {
      if (this.running) return;
      this.dom.start();
      if (this.observeNavigation && this.window) {
        this.window.addEventListener("popstate", this.onNavigation);
        this.window.addEventListener("hashchange", this.onNavigation);
        this.removeHistoryListener = addHistoryListener(this.window, this.onNavigation);
      }
      this.running = true;
    }
    stop() {
      if (!this.running) return;
      this.dom.stop();
      if (this.observeNavigation && this.window) {
        this.window.removeEventListener("popstate", this.onNavigation);
        this.window.removeEventListener("hashchange", this.onNavigation);
      }
      this.removeHistoryListener?.();
      this.removeHistoryListener = void 0;
      this.navigationNotify.cancel();
      this.running = false;
    }
  };

  // src/runtime/index.ts
  function defaultRoot() {
    if (typeof globalThis === "undefined") return void 0;
    const candidate = globalThis.document;
    return candidate && typeof candidate === "object" && "querySelectorAll" in candidate ? candidate : void 0;
  }
  function jsonError(code, message) {
    return { status: "blocked", code, error: message };
  }
  function interactionRequest(tool, evaluation) {
    return {
      type: "webmcp-confirmation",
      toolName: tool.name,
      description: tool.description,
      risk: tool.risk.level,
      reasons: evaluation.reasons.map((item) => ({ code: item.code, message: item.message }))
    };
  }
  function confirmed(result) {
    return result.confirmed === true || result.approved === true;
  }
  function safeHandler(handler, input) {
    return Promise.resolve().then(() => handler(input)).catch(() => jsonError("tool-failed", "Tool execution failed."));
  }
  function descriptorOf(tool) {
    const descriptor = { ...tool };
    delete descriptor.handler;
    return Object.freeze(descriptor);
  }
  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
      const entries = Object.entries(value).filter(([, item]) => item !== void 0).sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  function discoveredToolFingerprint(tool) {
    return stableStringify(descriptorOf(tool));
  }
  function createWebMCPRuntime(options = {}) {
    const mode = options.mode ?? "hybrid";
    const adapter = options.adapter ?? new BrowserModelContextAdapter();
    const registry = new CapabilityRegistry();
    const diagnostics = [];
    const platformRegistrations = /* @__PURE__ */ new Map();
    const discoveredTools = /* @__PURE__ */ new Map();
    const policyConfig = {
      ...options.policy ?? options.policyConfig ?? {},
      ...options.confirmationPolicy === void 0 ? {} : { confirmationPolicy: options.confirmationPolicy }
    };
    const root = options.root ?? defaultRoot();
    const discoveryOptions = options.discovery ?? options.discoveryOptions ?? {};
    const autoDiscover = options.autoDiscover ?? true;
    const observe = options.observe ?? (autoDiscover && !!root);
    const synchronization = {
      waitAfterInvoke: options.synchronization?.waitAfterInvoke !== false,
      settleMs: Math.max(0, options.synchronization?.settleMs ?? 100),
      timeoutMs: Math.max(0, options.synchronization?.timeoutMs ?? 2e3),
      busySelector: options.synchronization?.busySelector ?? '[aria-busy="true"], [data-webmcp-busy="true"]'
    };
    let running = false;
    let destroyed = false;
    let observer;
    let rescanScheduled = false;
    let rescanRunning = false;
    let syncRevision = 0;
    let lastInvalidation = Date.now();
    let invalidationCleanups = [];
    let semanticGraph;
    const addDiagnostic = (diagnostic) => {
      diagnostics.push(diagnostic);
    };
    const policyFor = (tool) => evaluateToolPolicy(tool, mode, policyConfig);
    const invokeThroughPolicy = async (tool, input) => {
      const evaluation = policyFor(tool);
      if (evaluation.decision === "deny") {
        addDiagnostic({ code: "tool-denied", message: "Tool invocation denied by policy.", toolName: tool.name, reasons: evaluation.reasons });
        return { ...jsonError("tool-denied", "Tool invocation denied by policy."), reasons: evaluation.reasons.map((item) => item.code) };
      }
      if (evaluation.decision === "confirm") {
        if (!adapter.requestUserInteraction) {
          addDiagnostic({ code: "confirmation-unavailable", message: "User confirmation is unavailable.", toolName: tool.name, reasons: evaluation.reasons });
          return jsonError("confirmation-unavailable", "User confirmation is unavailable.");
        }
        try {
          const result2 = await adapter.requestUserInteraction(interactionRequest(tool, evaluation));
          if (!confirmed(result2)) {
            addDiagnostic({ code: "confirmation-rejected", message: "User confirmation was not granted.", toolName: tool.name, reasons: evaluation.reasons });
            return jsonError("confirmation-rejected", "User confirmation was not granted.");
          }
        } catch {
          addDiagnostic({ code: "confirmation-unavailable", message: "User confirmation failed.", toolName: tool.name, reasons: evaluation.reasons });
          return jsonError("confirmation-unavailable", "User confirmation failed.");
        }
      }
      const result = await safeHandler(tool.handler, input);
      if (synchronization.waitAfterInvoke && (tool.kind === "action" || tool.kind === "form")) {
        rescan();
        const sync = await waitForIdleInternal();
        if (sync.status === "timeout") {
          addDiagnostic({
            code: "synchronization-timeout",
            message: "The UI did not reach an idle synchronized state before the timeout.",
            toolName: tool.name
          });
        }
      }
      return result;
    };
    const wrappedTool = (tool) => ({
      ...tool,
      handler: (input) => invokeThroughPolicy(tool, input)
    });
    const registerPlatform = (tool) => {
      if (!running || platformRegistrations.has(tool.name)) return;
      const evaluation = policyFor(tool);
      if (evaluation.decision === "deny") {
        addDiagnostic({ code: "tool-denied", message: "Tool was not registered because policy denied it.", toolName: tool.name, reasons: evaluation.reasons });
        return;
      }
      if (!adapter.isAvailable()) {
        addDiagnostic({ code: "platform-unavailable", message: "WebMCP platform is unavailable; tool remains available locally.", toolName: tool.name });
        return;
      }
      const registration = Symbol(tool.name);
      platformRegistrations.set(tool.name, registration);
      try {
        const result = adapter.registerTool(wrappedTool(tool));
        if (!result.ready) return;
        void Promise.resolve(result.ready).catch(() => {
          if (platformRegistrations.get(tool.name) !== registration) return;
          platformRegistrations.delete(tool.name);
          addDiagnostic({ code: "platform-registration-failed", message: "Tool could not be registered on the platform.", toolName: tool.name });
        });
      } catch {
        platformRegistrations.delete(tool.name);
        addDiagnostic({ code: "platform-registration-failed", message: "Tool could not be registered on the platform.", toolName: tool.name });
      }
    };
    const unregisterPlatform = (name) => {
      if (!platformRegistrations.has(name)) return;
      try {
        adapter.unregisterTool(name);
        platformRegistrations.delete(name);
      } catch {
        addDiagnostic({ code: "platform-unregistration-failed", message: "Tool could not be removed from the platform.", toolName: name });
      }
    };
    registry.subscribe((event) => {
      if (!running) return;
      if (event.type === "clear") {
        for (const name of [...platformRegistrations.keys()]) unregisterPlatform(name);
        return;
      }
      if (!event.name) return;
      if (event.type === "unregister") {
        unregisterPlatform(event.name);
        return;
      }
      if (event.type === "replace") unregisterPlatform(event.name);
      const current = registry.get(event.name);
      if (current) registerPlatform(current);
    });
    const registerInRegistry = (tool) => {
      if (destroyed) throw new RuntimeDestroyedError();
      try {
        return registry.register(tool);
      } catch (error) {
        addDiagnostic({ code: "tool-registration-failed", message: error instanceof Error ? error.message : "Tool registration failed.", toolName: tool.name });
        throw error;
      }
    };
    const reconcileDiscovery = () => {
      if (destroyed || mode !== "auto" && mode !== "hybrid" || !root) return;
      let tools;
      try {
        const compilation = discoverSemanticUI(root, discoveryOptions);
        tools = compilation.tools;
        semanticGraph = compilation.graph;
      } catch {
        addDiagnostic({ code: "discovery-failed", message: "UI discovery failed." });
        return;
      }
      const next = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of discoveredTools.keys()) {
        if (next.has(name)) continue;
        registry.unregister(name);
        discoveredTools.delete(name);
      }
      for (const tool of next.values()) {
        const fingerprint2 = discoveredToolFingerprint(tool);
        const current = registry.get(tool.name);
        if (!current) {
          try {
            registerInRegistry(tool);
            discoveredTools.set(tool.name, fingerprint2);
          } catch {
          }
        } else if (discoveredTools.has(tool.name) && discoveredTools.get(tool.name) !== fingerprint2) {
          try {
            registry.replace(tool);
            discoveredTools.set(tool.name, fingerprint2);
          } catch {
          }
        }
      }
    };
    const rescan = () => {
      if (!running || destroyed) return;
      lastInvalidation = Date.now();
      if (rescanScheduled) return;
      rescanScheduled = true;
      queueMicrotask(() => {
        rescanScheduled = false;
        if (!running || destroyed) return;
        rescanRunning = true;
        try {
          reconcileDiscovery();
          syncRevision += 1;
        } finally {
          rescanRunning = false;
          lastInvalidation = Date.now();
        }
      });
    };
    const hasBusyState = () => {
      if (!root || !synchronization.busySelector) return false;
      try {
        return root.querySelector(synchronization.busySelector) !== null;
      } catch {
        return false;
      }
    };
    async function waitForIdleInternal(waitOptions = {}) {
      if (destroyed) throw new RuntimeDestroyedError();
      const settleMs = Math.max(0, waitOptions.settleMs ?? synchronization.settleMs);
      const timeoutMs = Math.max(0, waitOptions.timeoutMs ?? synchronization.timeoutMs);
      const startedAt = Date.now();
      await Promise.resolve();
      return new Promise((resolve) => {
        const check = () => {
          const elapsedMs = Date.now() - startedAt;
          const quietFor = Date.now() - lastInvalidation;
          if (!rescanScheduled && !rescanRunning && quietFor >= settleMs && !hasBusyState()) {
            resolve({ status: "idle", revision: syncRevision, elapsedMs });
            return;
          }
          if (elapsedMs >= timeoutMs) {
            resolve({ status: "timeout", revision: syncRevision, elapsedMs });
            return;
          }
          const remaining = timeoutMs - elapsedMs;
          setTimeout(check, Math.min(25, Math.max(1, remaining)));
        };
        check();
      });
    }
    const discover = () => {
      if (destroyed || mode !== "auto" && mode !== "hybrid" || !root) return Object.freeze([]);
      let tools;
      try {
        const compilation = discoverSemanticUI(root, discoveryOptions);
        tools = compilation.tools;
        semanticGraph = compilation.graph;
      } catch {
        addDiagnostic({ code: "discovery-failed", message: "UI discovery failed." });
        return Object.freeze([]);
      }
      const added = [];
      for (const tool of tools) {
        if (registry.get(tool.name) || discoveredTools.has(tool.name)) continue;
        try {
          const stored = registerInRegistry(tool);
          discoveredTools.set(stored.name, discoveredToolFingerprint(stored));
          added.push(stored);
        } catch {
        }
      }
      return Object.freeze(added);
    };
    const runtime = {
      mode,
      diagnostics,
      start() {
        if (destroyed || running) return;
        running = true;
        for (const tool of registry.list()) registerPlatform(tool);
        if (autoDiscover) discover();
        if (observe && autoDiscover && root) {
          observer ??= new RuntimeObserver(root, rescan, options.observerOptions);
          observer.start();
        }
        invalidationCleanups = [];
        for (const source of options.invalidationSources ?? []) {
          try {
            const cleanup = source.subscribe(rescan);
            if (cleanup) invalidationCleanups.push(cleanup);
          } catch {
            addDiagnostic({
              code: "invalidation-source-failed",
              message: "An application invalidation source could not be subscribed."
            });
          }
        }
      },
      stop() {
        if (!running && platformRegistrations.size === 0) return;
        for (const name of [...platformRegistrations.keys()]) unregisterPlatform(name);
        if (!running) return;
        observer?.stop();
        for (const cleanup of invalidationCleanups.splice(0)) {
          try {
            cleanup();
          } catch {
            addDiagnostic({
              code: "invalidation-source-failed",
              message: "An application invalidation source could not be unsubscribed."
            });
          }
        }
        rescanScheduled = false;
        rescanRunning = false;
        for (const name of discoveredTools.keys()) registry.unregister(name);
        discoveredTools.clear();
        running = false;
      },
      isRunning: () => running,
      destroy() {
        if (destroyed) return;
        runtime.stop();
        registry.clear();
        discoveredTools.clear();
        destroyed = true;
      },
      registerTool(tool) {
        return descriptorOf(registerInRegistry(tool));
      },
      unregisterTool(name) {
        if (destroyed) throw new RuntimeDestroyedError();
        discoveredTools.delete(name);
        return registry.unregister(name);
      },
      discover: () => Object.freeze(discover().map(descriptorOf)),
      refresh() {
        if (destroyed) throw new RuntimeDestroyedError();
        lastInvalidation = Date.now();
        reconcileDiscovery();
        syncRevision += 1;
        lastInvalidation = Date.now();
        return Object.freeze(registry.list().map(descriptorOf));
      },
      waitForIdle(waitOptions = {}) {
        if (destroyed) throw new RuntimeDestroyedError();
        if (running) rescan();
        else runtime.refresh();
        return waitForIdleInternal(waitOptions);
      },
      async waitForTool(name, waitOptions = {}) {
        if (destroyed) throw new RuntimeDestroyedError();
        const timeoutMs = Math.max(0, waitOptions.timeoutMs ?? synchronization.timeoutMs);
        const startedAt = Date.now();
        do {
          runtime.refresh();
          const current = registry.get(name);
          if (current) return descriptorOf(current);
          const elapsed = Date.now() - startedAt;
          if (elapsed >= timeoutMs) return void 0;
          await new Promise((resolve) => setTimeout(resolve, Math.min(25, timeoutMs - elapsed)));
        } while (!destroyed);
        throw new RuntimeDestroyedError();
      },
      listTools: () => Object.freeze(registry.list().map(descriptorOf)),
      getSemanticGraph: () => semanticGraph,
      invokeTool(name, input) {
        if (destroyed) throw new RuntimeDestroyedError();
        const tool = registry.get(name);
        if (!tool) {
          const error = jsonError("tool-not-found", `Tool "${name}" is not registered.`);
          addDiagnostic({ code: "tool-not-found", message: error.error, toolName: name });
          return Promise.resolve(error);
        }
        return invokeThroughPolicy(tool, input);
      },
      getPolicyDecision(tool) {
        const value = typeof tool === "string" ? registry.get(tool) : tool;
        return value ? policyFor(value) : void 0;
      }
    };
    for (const tool of options.initialTools ?? []) registerInRegistry(tool);
    if (options.autoStart === true) runtime.start();
    return runtime;
  }

  // src/mapping/index.ts
  var namePattern2 = /^[A-Za-z][A-Za-z0-9._-]*$/;
  var actions = ["fill", "submit", "click", "select", "toggle"];
  function isJsonObject2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function validateJsonObject(value, field) {
    if (value !== void 0 && !isJsonObject2(value)) {
      throw new TypeError(`Manual mapping ${field} must be a JSON object.`);
    }
  }
  function validateMapping(mapping) {
    if (typeof mapping.name !== "string" || !mapping.name.trim() || !namePattern2.test(mapping.name)) {
      throw new TypeError("Manual mapping name must be a non-empty stable identifier (letters, digits, ., _, -).");
    }
    if (typeof mapping.selector !== "string" || !mapping.selector.trim() || mapping.selector.includes("\0")) {
      throw new TypeError("Manual mapping selector must be a non-empty CSS selector.");
    }
    if (!actions.includes(mapping.action)) {
      throw new TypeError(`Manual mapping action must be one of: ${actions.join(", ")}.`);
    }
    if (mapping.description !== void 0 && !mapping.description.trim()) {
      throw new TypeError("Manual mapping description cannot be empty.");
    }
    validateJsonObject(mapping.inputSchema, "inputSchema");
    validateJsonObject(mapping.outputSchema, "outputSchema");
    validateJsonObject(mapping.metadata, "metadata");
    if (mapping.risk !== void 0 && !["low", "medium", "high", "critical"].includes(mapping.risk.level)) {
      throw new TypeError("Manual mapping risk.level must be low, medium, high, or critical.");
    }
    if (mapping.root !== void 0 && (typeof mapping.root !== "object" || typeof mapping.root.querySelector !== "function")) {
      throw new TypeError("Manual mapping root must be a ParentNode.");
    }
    try {
      const root = mapping.root ?? getDefaultRoot();
      root?.querySelector(mapping.selector);
    } catch {
      throw new TypeError(`Manual mapping selector is not a valid CSS selector: ${mapping.selector}`);
    }
  }
  function getDefaultRoot() {
    if (typeof globalThis === "undefined") return void 0;
    const candidate = globalThis.document;
    return candidate && typeof candidate === "object" && typeof candidate.querySelector === "function" ? candidate : void 0;
  }
  function jsonResult(result) {
    try {
      JSON.stringify(result);
      return result;
    } catch {
      return { status: "error", error: "non-serializable-result" };
    }
  }
  function createManualMappingTool(mapping) {
    validateMapping(mapping);
    const description = mapping.description ?? mapping.name;
    const risk = mapping.risk ?? { level: "medium" };
    return {
      name: mapping.name,
      description,
      kind: mapping.kind ?? "action",
      inputSchema: mapping.inputSchema ?? { type: "object" },
      outputSchema: mapping.outputSchema ?? { type: "object" },
      risk,
      provenance: { source: "manual", confidence: 1, sourceId: mapping.name },
      targetUI: { selector: mapping.selector, description },
      metadata: mapping.metadata,
      handler: (input) => {
        const root = mapping.root ?? getDefaultRoot();
        if (!root) return { status: "error", action: mapping.action, selector: mapping.selector, error: "root-not-found" };
        return jsonResult(executeDomAction(root, mapping.selector, mapping.action, input, {
          allowSensitiveFormFields: mapping.allowSensitiveFormFields
        }));
      }
    };
  }

  // src/browser.ts
  var autoRuntime = (() => {
    if (typeof document === "undefined") return void 0;
    const script = document.currentScript;
    if (!(script instanceof HTMLScriptElement) || !script.hasAttribute("data-webmcp-auto")) return void 0;
    return createWebMCPRuntime({ autoStart: true });
  })();
  return __toCommonJS(browser_exports);
})();
//# sourceMappingURL=browser.iife.js.map