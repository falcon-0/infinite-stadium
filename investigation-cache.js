// One current received-evidence inspection. Keys must include every input that
// can change the result (event revisions, position revisions and preferences).
export class InvestigationCache {
  constructor({ load, apply, onError = () => {} }) {
    if (typeof load !== 'function' || typeof apply !== 'function' || typeof onError !== 'function')
      throw new TypeError('Inspection callbacks must be functions.');
    this.load = load;
    this.apply = apply;
    this.onError = onError;
    this.pending = null;
    this.completed = null;
    this.disposed = false;
  }
  request(key, input) {
    if (this.disposed) throw new Error('Inspection cache is disposed.');
    if (typeof key !== 'string' || !key)
      throw new TypeError('Inspection key must be a nonempty string.');
    if (this.pending?.key === key) return this.pending.promise;
    if (!this.pending && this.completed?.key === key)
      return Promise.resolve({ status: 'cached', key, value: this.completed.value });
    this.reset();
    const task = { key, input, controller: new AbortController(), promise: null };
    this.pending = task;
    task.promise = Promise.resolve().then(async () => {
      // A request can be superseded before the loader's first microtask.
      if (task.controller.signal.aborted) return { status: 'cancelled', key };
      try {
        const value = await this.load(input, { key, signal: task.controller.signal });
        if (this.pending !== task || task.controller.signal.aborted)
          return { status: 'cancelled', key };
        this.apply(value, { key, input });
        // apply may reset/dispose the scheduler or start a new inspection.
        if (this.pending !== task || task.controller.signal.aborted)
          return { status: 'cancelled', key };
        this.completed = { key, value };
        return { status: 'applied', key, value };
      } catch (error) {
        if (this.pending !== task || task.controller.signal.aborted || error?.name === 'AbortError')
          return { status: 'cancelled', key };
        this.onError(error, { key, input });
        return { status: 'error', key, error };
      } finally {
        if (this.pending === task) this.pending = null;
      }
    });
    return task.promise;
  }
  reset() {
    this.pending?.controller.abort();
    this.pending = null;
    this.completed = null;
  }
  dispose() {
    this.reset();
    this.disposed = true;
  }
}
