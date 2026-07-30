export class CapabilityValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CapabilityValidationError';
  }
}

export class DuplicateCapabilityError extends Error {
  public constructor(name: string) {
    super(`Capability "${name}" is already registered.`);
    this.name = 'DuplicateCapabilityError';
  }
}

export class MissingCapabilityError extends Error {
  public constructor(name: string) {
    super(`Capability "${name}" is not registered.`);
    this.name = 'MissingCapabilityError';
  }
}

export class RuntimeDestroyedError extends Error {
  public constructor() {
    super('The WebMCP runtime has been destroyed and cannot be mutated.');
    this.name = 'RuntimeDestroyedError';
  }
}
