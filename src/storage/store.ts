import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type Store = {
  db: Database.Database;
  close(): void;
};

export type OpenStoreOptions = {
  path: string;          // ':memory:' or absolute file path
  readonly?: boolean;
};

/**
 * Run multi-statement DDL against the store. Wraps better-sqlite3's
 * native multi-statement runner. NOT a child_process call.
 */
export function runSql(db: Database.Database, sql: string): void {
  db.exec(sql);
}

export async function openStore(options: OpenStoreOptions): Promise<Store> {
  if (options.path !== ':memory:') {
    const dir = dirname(options.path);
    if (!existsSync(dir)) {
      throw new Error(
        `Cannot open SQLite store: directory does not exist: ${dir}`
      );
    }
  }

  const db = new Database(options.path, { readonly: options.readonly ?? false });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);

  return {
    db,
    close: () => db.close(),
  };
}
