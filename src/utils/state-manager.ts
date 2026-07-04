/**
 * Generic state management utility for managing keyed state
 */

/**
 * A generic state manager that stores and retrieves state by key
 */
export class StateManager<T> {
  private states: Map<string, T> = new Map();

  /**
   * Gets existing state or creates it using the factory function
   */
  getOrCreate(key: string, factory: () => T): T {
    let state = this.states.get(key);
    if (!state) {
      state = factory();
      this.states.set(key, state);
    }
    return state;
  }

  /**
   * Gets state by key, returns undefined if not found
   */
  get(key: string): T | undefined {
    return this.states.get(key);
  }

  /**
   * Sets state for a key
   */
  set(key: string, state: T): void {
    this.states.set(key, state);
  }

  /**
   * Checks if a key exists
   */
  has(key: string): boolean {
    return this.states.has(key);
  }

  /**
   * Deletes state by key
   */
  delete(key: string): boolean {
    return this.states.delete(key);
  }

  /**
   * Clears all state
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Returns an iterator over all entries
   */
  entries(): IterableIterator<[string, T]> {
    return this.states.entries();
  }

  /**
   * Returns the number of stored states
   */
  get size(): number {
    return this.states.size;
  }
}
