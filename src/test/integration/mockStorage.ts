import { IGlobalState, ISecretStorage, IStorageContext } from '../../storage/IStorageContext';

export class MockGlobalState implements IGlobalState {
  private readonly data = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T {
    return (this.data.has(key) ? this.data.get(key) : defaultValue) as T;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  // Test helper — exposes raw storage without going through get() overloads
  rawGet<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
}

export class MockSecretStorage implements ISecretStorage {
  private readonly data = new Map<string, string>();

  get(key: string): Thenable<string | undefined> {
    return Promise.resolve(this.data.get(key));
  }

  store(key: string, value: string): Thenable<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Thenable<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

export function makeMockContext(): IStorageContext & { globalState: MockGlobalState; secrets: MockSecretStorage } {
  return { globalState: new MockGlobalState(), secrets: new MockSecretStorage() };
}
