import { describe, it, expect } from 'vitest';
import { openStore } from '../src/storage/store.js';
import { migrate, getAppliedMigrations } from '../src/storage/migrations.js';

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

describe('migrations', () => {
  it('applies migrations idempotently and records them in schema_versions', async () => {
    const store = await openStore({ path: ':memory:' });

    await migrate(store, [
      { id: '001_test', sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY, label TEXT);' },
    ]);

    const applied = getAppliedMigrations(store);
    expect(applied).toEqual(['001_test']);

    // Idempotent: second call is a no-op
    await migrate(store, [
      { id: '001_test', sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY, label TEXT);' },
    ]);
    expect(getAppliedMigrations(store)).toEqual(['001_test']);

    store.close();
  });

  it('runs new migrations in order, skipping already-applied ones', async () => {
    const store = await openStore({ path: ':memory:' });

    await migrate(store, [
      { id: '001', sql: 'CREATE TABLE a (x INTEGER);' },
    ]);
    await migrate(store, [
      { id: '001', sql: 'CREATE TABLE a (x INTEGER);' },
      { id: '002', sql: 'CREATE TABLE b (y INTEGER);' },
    ]);

    expect(getAppliedMigrations(store)).toEqual(['001', '002']);
    store.close();
  });
});
