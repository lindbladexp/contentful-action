import { afterEach, beforeEach, vi } from 'vitest';
import { restoreContext } from './helpers';

// The Logger is extremely chatty (it logs on entry to most functions), which
// would bury the actual test output. Assertions never target the logs.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'trace').mockImplementation(() => {});
});

afterEach(() => {
  restoreContext();
});
