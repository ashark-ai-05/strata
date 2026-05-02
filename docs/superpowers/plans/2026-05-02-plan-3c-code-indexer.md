# Plan 3c — Code Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AST-aware code indexing for TypeScript/TSX (the most common language in this repo's own stack), with a `LanguageAdapter` architecture so adding Python / Go / Java / etc. in follow-up plans is purely additive. Symbols (functions, classes, methods, interfaces) are extracted via tree-sitter and stored in the `symbols` table; chunks respect symbol boundaries (no mid-function splits) and land in `chunks` + `embeddings` alongside the document indexer's output. CLI commands `--index-code` and `--search-symbols`.

**Architecture:** `web-tree-sitter` (WASM-based; portable, zero native compile) loads `tree-sitter-typescript.wasm` lazily. A `LanguageAdapter` interface exposes `extract(source) → Symbol[]` per language. The `TypeScriptAdapter` runs a tree-sitter query that captures top-level function/class/method/interface declarations with their byte ranges. The `CodeChunker` uses those ranges to chunk source files at symbol boundaries (one chunk per top-level symbol; whole-file fallback for files with no extracted symbols, like config files). The `CodeIndexer` walks `.ts`/`.tsx`/`.js`/`.jsx` files (via `walkCodeFiles`, parallel to Plan 3a's `walkTextFiles`), invokes the adapter, chunks, embeds, and writes to both `chunks` (with `kind: 'code-symbol'` or `'code-file'`) and `symbols` (with intra-file refs). Idempotent re-runs use the same `(source_id, uri)` UNIQUE constraint as the document indexer.

**Tech Stack:** Node.js 24+ · TypeScript · `web-tree-sitter` (WASM runtime) · `tree-sitter-typescript` (npm package shipping `.wasm` grammar files) · existing storage / embedder / Plan 3a chunking infrastructure · Vitest.

**References:**
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §3 (`code-symbol`, `code-file` kinds), §4 (code indexer policy: tree-sitter, AST-aware chunking, intra-file call graph)
- Plan 3a: `docs/superpowers/plans/2026-05-02-plan-3a-document-indexer-and-search.md` — document indexer pattern + walker + chunker; we mirror its idempotency approach
- web-tree-sitter docs: https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web

**Out of scope (deferred to follow-up plans):**
- Python adapter (Plan 3c.1)
- Go adapter (Plan 3c.2)
- Java adapter (Plan 3c.3)
- Cross-file symbol graph (Plan 3c.4 — requires multi-pass indexing; v1 is intra-file only)
- Hover-style "go to definition" / "find references" CLI commands (Plan 3c.5)
- Streaming live re-index on file save (Plan 3f — orchestrator)

The architecture is built so each new language adapter is ~50 LOC.

---

## File structure

### New files

```
src/
  indexer/
    code/
      parser.ts                      # web-tree-sitter init + WASM resolution
      language-adapter.ts            # interface + Symbol type
      adapters/
        typescript.ts                # TypeScriptAdapter — handles .ts/.tsx/.js/.jsx
      code-chunker.ts                # AST-aware chunker (uses Symbol ranges)
      code-indexer.ts                # walks code files, runs adapter, stores
  walk/
    code-files.ts                    # walkCodeFiles — recursive .ts/.tsx/.js/.jsx walker (sibling to Plan 3a's walkTextFiles)
__tests__/
  code-language-typescript.test.ts   # unit-tests TypeScriptAdapter on inline source
  code-chunker.test.ts               # unit-tests AST-aware chunking
  code-indexer.test.ts               # integration: tmp dir of .ts files → indexed
```

### Modified files

```
package.json                          # add web-tree-sitter + tree-sitter-typescript
src/cli.ts                            # add --index-code <path>, --search-symbols <name>
README.md                             # Code indexing section
```

### Files NOT touched

`src/indexer/chunker.ts`, `src/indexer/document-indexer.ts`, `src/indexer/fs-walk.ts` — Plan 3a's document path stays stable. We add a parallel code path; the orchestrator (Plan 3f) unifies them later.

---

## Task 0: Add tree-sitter deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps**

Edit `package.json`:

```json
"dependencies": {
  // ... existing ...
  "web-tree-sitter": "^0.24.0",
  "tree-sitter-typescript": "^0.23.0"
}
```

If those exact versions don't resolve, use `*` for current stable.

- [ ] **Step 2: Install**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm install
```

Expected: clean install. `web-tree-sitter` is a JS+WASM package (no native build). `tree-sitter-typescript` ships pre-built `.wasm` files in its package contents — do NOT use the C-binding entry. Confirm:

```bash
ls /Users/krunal/Development/llm-wiki/node_modules/tree-sitter-typescript/*.wasm 2>/dev/null
```

Expected output: at least `tree-sitter-typescript.wasm` and `tree-sitter-tsx.wasm` (one for `.ts`, one for `.tsx`). If the WASM files are NOT in `node_modules/tree-sitter-typescript/`, search for them:

```bash
find /Users/krunal/Development/llm-wiki/node_modules/tree-sitter-typescript -name "*.wasm" 2>/dev/null
```

Document the actual paths in the Task 1 commit if they differ from the expected location.

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add package.json pnpm-lock.yaml
git commit -m "chore: add web-tree-sitter and tree-sitter-typescript"
```

---

## Task 1: Tree-sitter parser init

**Files:**
- Create: `src/indexer/code/parser.ts`

A small singleton that initializes web-tree-sitter once and caches loaded grammars by language id. Returns a `Parser` instance ready to call `parse(source)`.

- [ ] **Step 1: Implement the parser init**

Create `src/indexer/code/parser.ts`:

```typescript
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

// web-tree-sitter has both a default-export and a namespace-export shape
// across versions. We use the default-export form which is stable since 0.22.
import Parser from 'web-tree-sitter';

let initPromise: Promise<void> | null = null;
const grammarCache = new Map<string, unknown>();

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  return initPromise;
}

/**
 * Resolve the path to a grammar's WASM file. We try the
 * tree-sitter-<lang> npm package layout first, then fall back to
 * sibling locations.
 */
function resolveGrammarWasm(packageName: string, wasmFileName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', '..', 'node_modules', packageName, wasmFileName),
    join(here, '..', '..', '..', '..', 'node_modules', packageName, wasmFileName),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `Could not find ${wasmFileName} in any of: ${candidates.join(', ')}`
  );
}

export type LanguageId = 'typescript' | 'tsx';

const GRAMMAR_FILES: Record<LanguageId, { pkg: string; file: string }> = {
  typescript: { pkg: 'tree-sitter-typescript', file: 'tree-sitter-typescript.wasm' },
  tsx:        { pkg: 'tree-sitter-typescript', file: 'tree-sitter-tsx.wasm' },
};

/**
 * Returns a Parser configured for the given language. Lazy-loads and
 * caches the grammar on first use.
 */
export async function getParser(language: LanguageId): Promise<Parser> {
  await ensureInit();
  let grammar = grammarCache.get(language);
  if (!grammar) {
    const { pkg, file } = GRAMMAR_FILES[language];
    const wasmPath = resolveGrammarWasm(pkg, file);
    // @ts-expect-error — Parser.Language is a runtime namespace
    grammar = await Parser.Language.load(wasmPath);
    grammarCache.set(language, grammar);
  }
  const parser = new Parser();
  // @ts-expect-error — setLanguage accepts the loaded grammar object
  parser.setLanguage(grammar);
  return parser;
}

/**
 * Pick a language id from a file extension. Returns null for unsupported.
 */
export function languageFromExtension(ext: string): LanguageId | null {
  const lower = ext.toLowerCase();
  if (lower === '.ts' || lower === '.mts' || lower === '.cts') return 'typescript';
  if (lower === '.tsx') return 'tsx';
  if (lower === '.js' || lower === '.mjs' || lower === '.cjs') return 'typescript'; // tree-sitter-typescript handles JS
  if (lower === '.jsx') return 'tsx';
  return null;
}
```

If the actual `web-tree-sitter` import shape differs from `import Parser from 'web-tree-sitter'` (some versions are named exports), adapt the import. The `@ts-expect-error` lines suppress version-dependent type quirks; remove them if your installed types match.

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0. If types are missing for `web-tree-sitter`, add `@ts-expect-error` or `as any` casts at the boundary — keep the casts narrow.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/code/parser.ts
git commit -m "feat(code-indexer): web-tree-sitter init + lazy grammar loading"
```

---

## Task 2: LanguageAdapter interface + Symbol type

**Files:**
- Create: `src/indexer/code/language-adapter.ts`

- [ ] **Step 1: Define the interface**

Create `src/indexer/code/language-adapter.ts`:

```typescript
export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type-alias'
  | 'variable';

/**
 * A symbol extracted from source code. Byte offsets are inclusive-exclusive
 * (`[startByte, endByte)`), measured against the UTF-8 bytes of the source.
 */
export type ExtractedSymbol = {
  name: string;
  kind: SymbolKind;
  startByte: number;
  endByte: number;
  startRow: number;        // 0-indexed line number
  endRow: number;
  /** Names referenced from inside this symbol's body (intra-file only). */
  refs: string[];
};

export interface LanguageAdapter {
  /** Stable id of the language adapter — used as `symbols.lang`. */
  readonly id: string;
  /** Which file extensions this adapter handles (e.g. ['.ts', '.tsx']). */
  readonly extensions: string[];
  /** Extract top-level + class-method symbols from source code. */
  extract(source: string): Promise<ExtractedSymbol[]>;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/code/language-adapter.ts
git commit -m "feat(code-indexer): LanguageAdapter interface + ExtractedSymbol type"
```

---

## Task 3: TypeScriptAdapter

**Files:**
- Create: `src/indexer/code/adapters/typescript.ts`
- Test: `__tests__/code-language-typescript.test.ts`

The adapter runs a tree-sitter query that captures top-level functions, classes, methods inside classes, interfaces, and type aliases. It also walks into each captured node's body and collects identifier names referenced from within (the `refs` field).

The query string below is built for `tree-sitter-typescript`'s grammar. It captures:
- `function foo() {}` → function
- `const foo = () => {}` at module scope → variable (still indexed as a symbol)
- `class Foo { method() {} }` → class + method
- `interface Foo {}` → interface
- `type Foo = ...` → type-alias

- [ ] **Step 1: Write the failing test**

Create `__tests__/code-language-typescript.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../src/indexer/code/adapters/typescript.js';

describe('TypeScriptAdapter', () => {
  const adapter = new TypeScriptAdapter('typescript');

  it('extracts a top-level function', async () => {
    const source = `function add(a: number, b: number) { return a + b; }`;
    const symbols = await adapter.extract(source);
    expect(symbols.find((s) => s.name === 'add' && s.kind === 'function')).toBeDefined();
  });

  it('extracts a class and its methods', async () => {
    const source = `
      class Greeter {
        constructor(public name: string) {}
        greet(): string { return 'hi ' + this.name; }
        farewell(): string { return 'bye ' + this.name; }
      }
    `;
    const symbols = await adapter.extract(source);
    expect(symbols.find((s) => s.name === 'Greeter' && s.kind === 'class')).toBeDefined();
    expect(symbols.find((s) => s.name === 'greet' && s.kind === 'method')).toBeDefined();
    expect(symbols.find((s) => s.name === 'farewell' && s.kind === 'method')).toBeDefined();
  });

  it('extracts interfaces and type aliases', async () => {
    const source = `
      interface Animal { name: string }
      type ID = string | number;
    `;
    const symbols = await adapter.extract(source);
    expect(symbols.find((s) => s.name === 'Animal' && s.kind === 'interface')).toBeDefined();
    expect(symbols.find((s) => s.name === 'ID' && s.kind === 'type-alias')).toBeDefined();
  });

  it('records intra-file refs for a function that calls another', async () => {
    const source = `
      function helper(x: number) { return x + 1; }
      function main(y: number) { return helper(y) * 2; }
    `;
    const symbols = await adapter.extract(source);
    const main = symbols.find((s) => s.name === 'main');
    expect(main?.refs).toContain('helper');
  });

  it('records valid byte ranges that reproduce the source', async () => {
    const source = `function foo() { return 1; }\nfunction bar() { return 2; }`;
    const symbols = await adapter.extract(source);
    const foo = symbols.find((s) => s.name === 'foo')!;
    const fooSource = source.slice(foo.startByte, foo.endByte);
    expect(fooSource).toContain('foo');
    expect(fooSource).toContain('return 1');
  });

  it('returns an empty array for source with no recognizable symbols', async () => {
    const symbols = await adapter.extract(`// just a comment`);
    expect(symbols).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test code-language-typescript
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the TypeScriptAdapter**

Create `src/indexer/code/adapters/typescript.ts`:

```typescript
import { getParser, type LanguageId } from '../parser.js';
import type {
  ExtractedSymbol,
  LanguageAdapter,
  SymbolKind,
} from '../language-adapter.js';

/**
 * Tree-sitter query capturing the symbols we care about for TypeScript.
 * Each capture name encodes the kind, and `@name` is the identifier.
 */
const QUERY_SOURCE = `
  ; Top-level function declarations
  (function_declaration name: (identifier) @name) @function

  ; Class declarations
  (class_declaration name: (type_identifier) @name) @class

  ; Method definitions inside classes
  (method_definition name: (property_identifier) @name) @method

  ; Interface declarations
  (interface_declaration name: (type_identifier) @name) @interface

  ; Type aliases
  (type_alias_declaration name: (type_identifier) @name) @type-alias

  ; Top-level const/let with arrow function or function expression initializer
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name
      value: [(arrow_function) (function_expression)])) @variable
`;

export class TypeScriptAdapter implements LanguageAdapter {
  readonly id: string;
  readonly extensions: string[];

  // Pass 'typescript' for .ts/.js or 'tsx' for .tsx/.jsx
  constructor(readonly languageId: LanguageId) {
    this.id = languageId;
    this.extensions =
      languageId === 'tsx'
        ? ['.tsx', '.jsx']
        : ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
  }

  async extract(source: string): Promise<ExtractedSymbol[]> {
    const parser = await getParser(this.languageId);
    const tree = parser.parse(source);

    // @ts-expect-error — language is a runtime property; types vary by SDK version
    const lang = parser.getLanguage();
    // @ts-expect-error — Query is a runtime constructor
    const query = new (lang.constructor as { Query: new (lang: unknown, source: string) => unknown }).Query(lang, QUERY_SOURCE);

    // @ts-expect-error — captures returns runtime SyntaxNode array
    const captures = (query as { captures: (node: unknown) => Array<{ name: string; node: unknown }> }).captures(
      // @ts-expect-error
      tree.rootNode,
    );

    // Group captures: every kind capture (`@function`, `@class`, etc.) is
    // followed by its `@name` capture. We pair them up.
    type Cap = { name: string; node: unknown };
    const symbols: ExtractedSymbol[] = [];

    let pending: { kind: SymbolKind; node: { startIndex: number; endIndex: number; startPosition: { row: number }; endPosition: { row: number } } } | null = null;

    const KIND_BY_CAPTURE: Record<string, SymbolKind> = {
      function: 'function',
      class: 'class',
      method: 'method',
      interface: 'interface',
      'type-alias': 'type-alias',
      variable: 'variable',
    };

    for (const cap of captures as Cap[]) {
      const node = cap.node as {
        startIndex: number;
        endIndex: number;
        startPosition: { row: number };
        endPosition: { row: number };
        text: string;
      };

      if (cap.name === 'name' && pending) {
        symbols.push({
          name: node.text,
          kind: pending.kind,
          startByte: pending.node.startIndex,
          endByte: pending.node.endIndex,
          startRow: pending.node.startPosition.row,
          endRow: pending.node.endPosition.row,
          refs: collectRefs(pending.node, source),
        });
        pending = null;
      } else if (KIND_BY_CAPTURE[cap.name]) {
        pending = { kind: KIND_BY_CAPTURE[cap.name], node };
      }
    }

    return symbols;
  }
}

/**
 * Collect identifier names referenced inside a node's body.
 * Walks the node's subtree and pulls every `identifier`/`type_identifier`
 * leaf that's NOT the symbol's own name. De-duped.
 */
function collectRefs(
  node: { walk: () => unknown; startIndex: number; endIndex: number; text: string },
  source: string
): string[] {
  // The node has a tree-walking cursor API, but the simplest portable
  // approach is to use the text + a regex pass. Tree-sitter is overkill
  // here for v1; for a true AST walk see Plan 3c.4.
  //
  // Extract the symbol's body text and pull bare identifiers. This is
  // approximate (catches type names too, for instance), but good enough
  // for the intra-file refs feature in v1.
  const body = source.slice(node.startIndex, node.endIndex);
  const matches = body.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? [];
  const KEYWORDS = new Set([
    'const', 'let', 'var', 'function', 'class', 'extends', 'implements',
    'interface', 'type', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'default', 'break', 'continue', 'throw', 'try',
    'catch', 'finally', 'new', 'typeof', 'instanceof', 'this', 'super',
    'true', 'false', 'null', 'undefined', 'void', 'public', 'private',
    'protected', 'static', 'readonly', 'async', 'await', 'yield',
    'import', 'export', 'from', 'as', 'of', 'in', 'string', 'number',
    'boolean', 'any', 'unknown', 'never',
  ]);
  const refs = new Set<string>();
  for (const m of matches) {
    if (!KEYWORDS.has(m)) refs.add(m);
  }
  return [...refs];
}
```

The TypeScript types around `web-tree-sitter` vary by version. The `@ts-expect-error` casts are localized to the SDK boundary. If your installed version exposes typed API surfaces (some 0.24+ versions do), remove them.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test code-language-typescript
```

Expected: PASS, all 6 tests green. If a particular query capture doesn't fire (e.g. `(method_definition ...)` returns nothing — node names vary by grammar version), inspect a small AST dump to debug:

```bash
cd /Users/krunal/Development/llm-wiki && pnpm tsx -e "
import { getParser } from './src/indexer/code/parser.js';
const parser = await getParser('typescript');
const tree = parser.parse('class Foo { bar() {} }');
console.log(tree.rootNode.toString());
"
```

Adapt the query to the actual node names. tree-sitter-typescript v0.23 uses `method_definition`, `function_declaration`, `class_declaration` etc. — the query above should work as-is, but verify.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/code/adapters/typescript.ts __tests__/code-language-typescript.test.ts
git commit -m "feat(code-indexer): TypeScriptAdapter — extract symbols + intra-file refs"
```

---

## Task 4: AST-aware code chunker

**Files:**
- Create: `src/indexer/code/code-chunker.ts`
- Test: `__tests__/code-chunker.test.ts`

Splits source into chunks using extracted symbols as boundaries. One chunk per symbol; remainder bytes (top-of-file imports, between-symbol bytes) collapse into "rest" chunks bounded by the surrounding symbols. Files with zero symbols become a single whole-file chunk.

- [ ] **Step 1: Write the failing test**

Create `__tests__/code-chunker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { chunkBySymbols, type CodeChunk } from '../src/indexer/code/code-chunker.js';
import type { ExtractedSymbol } from '../src/indexer/code/language-adapter.js';

function makeSymbol(name: string, startByte: number, endByte: number, kind: ExtractedSymbol['kind'] = 'function'): ExtractedSymbol {
  return {
    name,
    kind,
    startByte,
    endByte,
    startRow: 0,
    endRow: 0,
    refs: [],
  };
}

describe('chunkBySymbols', () => {
  it('returns one whole-file chunk when no symbols are extracted', () => {
    const source = '// only a comment';
    const chunks = chunkBySymbols(source, []);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('code-file');
    expect(chunks[0].text).toBe(source);
  });

  it('emits one chunk per symbol', () => {
    const source = 'function a() {}\nfunction b() {}\n';
    // a: [0, 15), b: [16, 31)
    const symbols = [
      makeSymbol('a', 0, 15),
      makeSymbol('b', 16, 31),
    ];
    const chunks = chunkBySymbols(source, symbols);
    const symbolChunks = chunks.filter((c) => c.kind === 'code-symbol');
    expect(symbolChunks).toHaveLength(2);
    expect(symbolChunks[0].symbolName).toBe('a');
    expect(symbolChunks[1].symbolName).toBe('b');
  });

  it('preserves source byte ranges accurately', () => {
    const source = 'function alpha() { return 1; }\nfunction beta() { return 2; }';
    const symbols = [
      makeSymbol('alpha', 0, 30),
      makeSymbol('beta', 31, 60),
    ];
    const chunks = chunkBySymbols(source, symbols);
    expect(chunks[0].text).toContain('alpha');
    expect(chunks[1].text).toContain('beta');
  });

  it('includes prelude (imports) as a code-file chunk before the first symbol', () => {
    const source = 'import { foo } from "x";\nfunction main() {}';
    const symbols = [makeSymbol('main', 25, 43)];
    const chunks = chunkBySymbols(source, symbols);

    // First chunk should be the prelude (imports)
    expect(chunks[0].kind).toBe('code-file');
    expect(chunks[0].text).toContain('import');
    // Then the main function chunk
    const mainChunk = chunks.find((c) => c.symbolName === 'main');
    expect(mainChunk).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test code-chunker
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the chunker**

Create `src/indexer/code/code-chunker.ts`:

```typescript
import type { ExtractedSymbol } from './language-adapter.js';

export type CodeChunk = {
  text: string;
  startByte: number;
  endByte: number;
  /** 'code-symbol' for symbol bodies, 'code-file' for non-symbol regions or whole-file fallback. */
  kind: 'code-symbol' | 'code-file';
  /** Set when kind === 'code-symbol'. */
  symbolName?: string;
  symbolKind?: ExtractedSymbol['kind'];
};

/**
 * Chunk source into:
 *   1. A "prelude" code-file chunk for any non-empty bytes before the
 *      first symbol (typically imports / module-level constants).
 *   2. One code-symbol chunk per extracted symbol.
 *   3. (Optional v1.5) "between" chunks for non-trivial bytes between
 *      symbols. Plan 3c v1 omits these — between-symbol bytes are
 *      typically just blank lines. Only the prelude is preserved.
 *   4. (Optional v1.5) "tail" chunk for trailing bytes. Same reasoning.
 *
 * Files with zero symbols return a single code-file chunk holding the
 * full source.
 */
export function chunkBySymbols(
  source: string,
  symbols: ExtractedSymbol[]
): CodeChunk[] {
  if (symbols.length === 0) {
    return [
      {
        text: source,
        startByte: 0,
        endByte: source.length,
        kind: 'code-file',
      },
    ];
  }

  // Sort by startByte for safety (queries usually return in order, but
  // be defensive).
  const sorted = [...symbols].sort((a, b) => a.startByte - b.startByte);
  const chunks: CodeChunk[] = [];

  // Prelude: bytes 0..firstSymbol.startByte
  const first = sorted[0];
  if (first.startByte > 0) {
    const preludeText = source.slice(0, first.startByte);
    if (preludeText.trim().length > 0) {
      chunks.push({
        text: preludeText,
        startByte: 0,
        endByte: first.startByte,
        kind: 'code-file',
      });
    }
  }

  // One chunk per symbol.
  for (const sym of sorted) {
    chunks.push({
      text: source.slice(sym.startByte, sym.endByte),
      startByte: sym.startByte,
      endByte: sym.endByte,
      kind: 'code-symbol',
      symbolName: sym.name,
      symbolKind: sym.kind,
    });
  }

  return chunks;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test code-chunker
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/code/code-chunker.ts __tests__/code-chunker.test.ts
git commit -m "feat(code-indexer): chunkBySymbols — AST-aware chunking with prelude"
```

---

## Task 5: Code file walker

**Files:**
- Create: `src/walk/code-files.ts`

Sibling to Plan 3a's `walkTextFiles`. Walks recursively, yields `.ts`/`.tsx`/`.js`/`.jsx`/`.mts`/`.cts`/`.mjs`/`.cjs` paths, skips the same hidden / build dirs.

- [ ] **Step 1: Implement**

Create `src/walk/code-files.ts`:

```typescript
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
]);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'vendor',
  'coverage', '.vitest-cache',
]);

export async function* walkCodeFiles(root: string): AsyncIterable<string> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      yield* walkCodeFiles(path);
    } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      yield path;
    }
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/walk/code-files.ts
git commit -m "feat(walk): walkCodeFiles — recursive .ts/.tsx/.js/.jsx walker"
```

---

## Task 6: CodeIndexer

**Files:**
- Create: `src/indexer/code/code-indexer.ts`
- Test: `__tests__/code-indexer.test.ts`

Wires walker + adapter + chunker + embedder + store. Idempotent re-runs (same `(source_id, uri)` strategy as Plan 3a). Writes both `chunks` and `symbols` rows.

- [ ] **Step 1: Write the failing test**

Create `__tests__/code-indexer.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, loadInitialMigrations } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { CodeIndexer } from '../src/indexer/code/code-indexer.js';
import type { EmbeddingProvider } from '../src/core/embedding-provider.js';

class FakeEmbedder implements EmbeddingProvider {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      const seed = (t.charCodeAt(0) || 1) + t.length;
      for (let i = 0; i < this.dims; i++) v[i] = (seed % (i + 7)) / 100;
      return v;
    });
  }
  async probe() {
    return { ok: true as const, dims: this.dims };
  }
}

describe('CodeIndexer', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'llm-wiki-code-test-'));
    writeFileSync(
      join(dir, 'a.ts'),
      `export function add(a: number, b: number) { return a + b; }
       export function sub(a: number, b: number) { return a - b; }`
    );
    writeFileSync(
      join(dir, 'b.ts'),
      `class Greeter {
        constructor(public name: string) {}
        greet() { return 'hi ' + this.name; }
      }`
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('walks .ts files, indexes symbols and chunks', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();

    const indexer = new CodeIndexer({ store, embedder });
    const result = await indexer.run({ rootPath: dir, sourceId: 'fixtures' });

    expect(result.indexedFiles).toBe(2);
    expect(result.symbols).toBeGreaterThanOrEqual(3); // add, sub, Greeter (greet may or may not be top-level)
    expect(result.chunks).toBeGreaterThanOrEqual(3);
    expect(result.errors).toEqual([]);

    const symbolRows = store.db
      .prepare("SELECT name, kind FROM symbols WHERE source_id = 'fixtures'")
      .all() as { name: string; kind: string }[];
    const names = symbolRows.map((r) => r.name);
    expect(names).toContain('add');
    expect(names).toContain('sub');
    expect(names).toContain('Greeter');

    const chunkRows = store.db
      .prepare("SELECT count(*) AS c FROM chunks WHERE source_id = 'fixtures'")
      .get() as { c: number };
    expect(chunkRows.c).toBeGreaterThanOrEqual(3);

    store.close();
  });

  it('is idempotent on re-run', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();
    const indexer = new CodeIndexer({ store, embedder });

    await indexer.run({ rootPath: dir, sourceId: 'fixtures' });
    const firstChunks = (store.db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number }).c;
    const firstSymbols = (store.db.prepare("SELECT count(*) AS c FROM symbols").get() as { c: number }).c;

    await indexer.run({ rootPath: dir, sourceId: 'fixtures' });
    const secondChunks = (store.db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number }).c;
    const secondSymbols = (store.db.prepare("SELECT count(*) AS c FROM symbols").get() as { c: number }).c;

    expect(secondChunks).toBe(firstChunks);
    expect(secondSymbols).toBe(firstSymbols);
    store.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test code-indexer
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the CodeIndexer**

Create `src/indexer/code/code-indexer.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { Store } from '../../storage/store.js';
import type { EmbeddingProvider } from '../../core/embedding-provider.js';
import { walkCodeFiles } from '../../walk/code-files.js';
import { TypeScriptAdapter } from './adapters/typescript.js';
import { chunkBySymbols } from './code-chunker.js';
import { languageFromExtension } from './parser.js';
import type { LanguageAdapter, ExtractedSymbol } from './language-adapter.js';

export type CodeIndexResult = {
  indexedFiles: number;
  chunks: number;
  symbols: number;
  errors: { path: string; error: string }[];
};

export type CodeIndexerOptions = {
  store: Store;
  embedder: EmbeddingProvider;
};

export type CodeIndexRunOptions = {
  rootPath: string;
  sourceId: string;
};

export class CodeIndexer {
  private readonly store: Store;
  private readonly embedder: EmbeddingProvider;

  // For now, two adapter instances cover the supported extensions.
  // Plan 3c.1+ adds Python / Go / Java adapters here.
  private readonly tsAdapter = new TypeScriptAdapter('typescript');
  private readonly tsxAdapter = new TypeScriptAdapter('tsx');

  constructor(options: CodeIndexerOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
  }

  private adapterFor(filePath: string): LanguageAdapter | null {
    const lang = languageFromExtension(extname(filePath));
    if (lang === 'tsx') return this.tsxAdapter;
    if (lang === 'typescript') return this.tsAdapter;
    return null;
  }

  async run(opts: CodeIndexRunOptions): Promise<CodeIndexResult> {
    const errors: { path: string; error: string }[] = [];
    let indexedFiles = 0;
    let totalChunks = 0;
    let totalSymbols = 0;

    const root = resolve(opts.rootPath);

    for await (const path of walkCodeFiles(root)) {
      try {
        const adapter = this.adapterFor(path);
        if (!adapter) continue;

        const source = await readFile(path, 'utf8');
        const symbols = await adapter.extract(source);
        const chunks = chunkBySymbols(source, symbols);
        if (chunks.length === 0) continue;

        const baseUri = `file://${path}`;
        const chunkUris = chunks.map((c, i) =>
          c.kind === 'code-symbol' && c.symbolName
            ? `${baseUri}#${c.symbolName}-${i}`
            : `${baseUri}#chunk-${i}`
        );

        const vectors = await this.embedder.embed(chunks.map((c) => c.text));

        const deleteOldChunks = this.store.db.prepare(
          `DELETE FROM chunks WHERE source_id = ? AND uri LIKE ?`
        );
        const deleteOldSymbols = this.store.db.prepare(
          `DELETE FROM symbols WHERE source_id = ? AND file = ?`
        );
        const insertChunk = this.store.db.prepare(
          `INSERT INTO chunks (source_id, kind, uri, body, meta_json, embedder_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const insertEmbedding = this.store.db.prepare(
          `INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`
        );
        const insertSymbol = this.store.db.prepare(
          `INSERT INTO symbols (source_id, file, name, kind, lang, refs_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        const tx = this.store.db.transaction(() => {
          deleteOldChunks.run(opts.sourceId, `${baseUri}%`);
          deleteOldSymbols.run(opts.sourceId, path);

          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const result = insertChunk.run(
              opts.sourceId,
              c.kind,
              chunkUris[i],
              c.text,
              JSON.stringify({
                startByte: c.startByte,
                endByte: c.endByte,
                symbolName: c.symbolName,
                symbolKind: c.symbolKind,
                file: path,
              }),
              this.embedder.id,
              Date.now()
            );
            const chunkId = BigInt(result.lastInsertRowid as bigint | number);
            insertEmbedding.run(chunkId, Buffer.from(vectors[i].buffer));
            totalChunks++;
          }

          for (const sym of symbols) {
            insertSymbol.run(
              opts.sourceId,
              path,
              sym.name,
              sym.kind,
              adapter.id,
              JSON.stringify(sym.refs),
              Date.now()
            );
            totalSymbols++;
          }
        });
        tx();

        indexedFiles++;
      } catch (e) {
        errors.push({
          path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { indexedFiles, chunks: totalChunks, symbols: totalSymbols, errors };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test code-indexer
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/code/code-indexer.ts __tests__/code-indexer.test.ts
git commit -m "feat(code-indexer): CodeIndexer — walks code, extracts symbols, chunks, stores"
```

---

## Task 7: CLI — `--index-code` and `--search-symbols`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the two branches**

Insert near the existing `--index` / `--search` branches (Plan 3a) in `src/cli.ts`:

```typescript
if (args.includes('--index-code')) {
  const idx = args.indexOf('--index-code');
  const path = args[idx + 1];
  if (!path) {
    console.error('Usage: pnpm cli --index-code <path>');
    process.exit(1);
  }

  const { activeProfile } = await loadConfig({ profileOverride });
  const { openDefaultStore } = await import('./storage/store.js');
  const { CodeIndexer } = await import('./indexer/code/code-indexer.js');

  const store = await openDefaultStore();
  const embedder = createEmbedder(activeProfile);
  const indexer = new CodeIndexer({ store, embedder });

  const sourceId = `local-code:${path}`;
  console.log(`Indexing code at ${path} (source: ${sourceId})…`);
  const t0 = performance.now();
  const result = await indexer.run({ rootPath: path, sourceId });
  const ms = Math.round(performance.now() - t0);

  console.log(`indexed:  ${result.indexedFiles} files`);
  console.log(`symbols:  ${result.symbols}`);
  console.log(`chunks:   ${result.chunks}`);
  console.log(`time:     ${ms} ms`);
  if (result.errors.length > 0) {
    console.log(`errors:   ${result.errors.length}`);
    for (const err of result.errors.slice(0, 5)) {
      console.log(`  - ${err.path}: ${err.error}`);
    }
  }
  store.close();
  return;
}

if (args.includes('--search-symbols')) {
  const idx = args.indexOf('--search-symbols');
  const name = args[idx + 1];
  if (!name) {
    console.error('Usage: pnpm cli --search-symbols <name-substring>');
    process.exit(1);
  }

  const { openDefaultStore } = await import('./storage/store.js');
  const store = await openDefaultStore();

  const rows = store.db
    .prepare(
      `SELECT name, kind, lang, file, source_id
       FROM symbols
       WHERE name LIKE ?
       ORDER BY name
       LIMIT 50`
    )
    .all(`%${name}%`) as {
      name: string;
      kind: string;
      lang: string;
      file: string;
      source_id: string;
    }[];

  console.log(`symbols matching "${name}": ${rows.length}`);
  for (const row of rows) {
    console.log(`  ${row.kind.padEnd(11)} ${row.name.padEnd(28)} ${row.file}`);
  }
  store.close();
  return;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: all passing.

- [ ] **Step 4: End-to-end smoke (uses bundled ONNX, will exercise model load)**

```bash
cd /Users/krunal/Development/llm-wiki

# Index this very repo's src/ (excluding node_modules per walker)
pnpm cli --index-code src/

# Search for a known symbol
pnpm cli --search-symbols MCPSource

# Combined: vector/keyword search across both code and docs (Plan 3a's index)
pnpm cli --search "createMcpClient"
```

Expected:
- `--index-code src/` indexes the project's TypeScript source — likely 30+ files, hundreds of symbols, runs in seconds (model is already cached)
- `--search-symbols MCPSource` returns at least one row for `class MCPSource`
- `--search "createMcpClient"` returns the relevant code chunk plus possibly docs that mention it

If the smoke fails:
- **TS query parse error:** the tree-sitter-typescript grammar may use slightly different node names. See Task 3 Step 4's debug snippet to inspect the AST and adjust the query.
- **WASM load error:** the path-resolution in `parser.ts` may need adjustment. Print `wasmPath` from inside `resolveGrammarWasm` to debug.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/cli.ts
git commit -m "feat(cli): --index-code <path> and --search-symbols <name>"
```

---

## Task 8: README — Code indexing section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append**

Add to `README.md` (after the existing Indexing and search section from Plan 3a):

```markdown
### Code indexing (Plan 3c)

`pnpm cli --index-code <path>` walks `.ts` / `.tsx` / `.js` / `.jsx` files, runs tree-sitter to extract top-level symbols (functions, classes, methods, interfaces, type aliases, arrow-function constants), AST-aware-chunks the source so symbol bodies stay intact, embeds each chunk via the active profile's embedder, and stores everything in `chunks` + `symbols` tables.

\`\`\`bash
# Index this repo's source
pnpm cli --index-code src/

# List symbols by name
pnpm cli --search-symbols MCPSource
#   class       MCPSource                       /Users/.../src/mcp/source.ts

# Hybrid search across code AND docs (Plan 3a + 3c share the same chunks/embeddings tables)
pnpm cli --search "createMcpClient"
\`\`\`

**Languages supported in v1:** TypeScript, TSX, JavaScript, JSX (one adapter handles all four — `tree-sitter-typescript` covers the JS subset).

**Adding a language** (Plan 3c.1+): write a new `LanguageAdapter` (~50 LOC) that extracts symbols via tree-sitter, register it in `CodeIndexer.adapterFor()`. Python, Go, Java, Ruby, etc. follow this pattern.

**Symbol storage:** the `symbols` table records `(name, kind, lang, file, refs_json)`. `refs_json` is an array of identifier names referenced from inside that symbol's body — basis for the intra-file call graph (full graph in Plan 3c.4).
```

(Replace escaped backticks with real triple-backticks.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: code indexing section"
```

---

## Spec coverage check

| Spec section | Implemented in (Plan 3c) | Deferred to |
| --- | --- | --- |
| §3 — `code-symbol` and `code-file` kinds | Tasks 4, 6 | — |
| §4 — Code indexer with tree-sitter | Tasks 1, 3, 6 | — |
| §4 — AST-aware chunking | Task 4 | — |
| §4 — Intra-file symbol refs | Task 3 (`collectRefs` + `refs_json`) | — |
| §4 — Multi-language code indexer | TS/JS today (Task 3) | Plan 3c.1+ (Python, Go, Java) |
| §4 — Cross-repo / cross-file call graph | — | Plan 3c.4 |

All Plan 3c v1 deliverables traced; deferrals enumerated.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0
- [ ] Typecheck passes: `pnpm typecheck` exits 0
- [ ] `pnpm cli --index-code src/` succeeds; index `> 30` files, `> 100` symbols
- [ ] `pnpm cli --search-symbols MCPSource` returns at least one row
- [ ] `pnpm cli --search "createMcpClient"` returns relevant code chunks
- [ ] Re-running `pnpm cli --index-code src/` is idempotent (chunk + symbol counts stay stable)
- [ ] `git log --oneline` shows ~9 new commits (one per task 0–8)

---

*End of Plan 3c.*
