// Keep received match facts while withdrawing preference-dependent presentation.
export function preferenceRefreshSnapshot(state) {
  return { ...state, overlays: new Map(), recap: new Map(), summary: '' };
}

// The same gate covers reconnects and seeks: a late response or error from an
// earlier preference must never unlock or replace the current view.
export class ViewerRefresh {
  constructor() {
    this.token = 0;
    this.status = 'ready';
  }
  begin(preserve = false) {
    this.token++;
    this.status = preserve ? 'updating' : 'ready';
    return this.token;
  }
  isCurrent(token) {
    return token === this.token;
  }
  finish(token) {
    if (!this.isCurrent(token)) return false;
    this.status = 'ready';
    return true;
  }
  fail(token) {
    if (!this.isCurrent(token)) return false;
    this.status = 'failed';
    return true;
  }
  get blocked() {
    return this.status !== 'ready';
  }
}
