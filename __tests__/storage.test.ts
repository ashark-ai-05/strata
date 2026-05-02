import { describe, it, expect } from 'vitest';
import { openStore } from '../src/storage/store.js';

describe('openStore', () => {
  it('opens an in-memory database and exposes the underlying handle', async () => {
    const store = await openStore({ path: ':memory:' });
    expect(store.db).toBeDefined();
    const result = store.db.prepare('SELECT 1 AS one').get() as { one: number };
    expect(result.one).toBe(1);
    store.close();
  });

  it('throws a descriptive error when the directory does not exist', async () => {
    await expect(
      openStore({ path: '/this/directory/does/not/exist/index.sqlite' })
    ).rejects.toThrow(/does not exist/);
  });
});
