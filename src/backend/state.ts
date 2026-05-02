import { loadConfig } from '../config/loader.js';
import { createProvider } from '../providers/index.js';
import { createEmbedder } from '../embedders/index.js';
import { SourceRegistry } from '../mcp/registry.js';
import { openDefaultStore, type Store } from '../storage/store.js';
import type { Profile } from '../config/schema.js';
import type { LLMProvider } from '../core/provider.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';

/**
 * Backend state. Constructed once at server start. Holds the
 * resolved active profile and lazily-instantiated providers.
 *
 * Note: `getLLMProvider()` and `getEmbedder()` are synchronous because
 * provider/embedder construction is itself synchronous (no I/O at ctor time).
 * The MCP source registry is async — call `ensureSourcesConnected()`
 * before using it; subsequent calls are cached.
 */
export class BackendState {
  readonly profile: Profile;
  readonly profileName: string;

  private llmProvider: LLMProvider | null = null;
  private embedder: EmbeddingProvider | null = null;
  private sourceRegistry = new SourceRegistry();
  private sourcesConnectedPromise: Promise<void> | null = null;
  private storePromise: Promise<Store> | null = null;

  private constructor(profile: Profile) {
    this.profile = profile;
    this.profileName = profile.name;
  }

  static async create(): Promise<BackendState> {
    const { activeProfile } = loadConfig();
    return new BackendState(activeProfile);
  }

  getLLMProvider(): LLMProvider {
    if (!this.llmProvider) {
      this.llmProvider = createProvider(this.profile);
    }
    return this.llmProvider;
  }

  getEmbedder(): EmbeddingProvider {
    if (!this.embedder) {
      this.embedder = createEmbedder(this.profile);
    }
    return this.embedder;
  }

  getSourceRegistry(): SourceRegistry {
    return this.sourceRegistry;
  }

  async getStore(): Promise<Store> {
    if (!this.storePromise) {
      this.storePromise = openDefaultStore();
    }
    return this.storePromise;
  }

  /**
   * Connects every configured source. Idempotent — subsequent calls
   * await the same promise.
   */
  async ensureSourcesConnected(): Promise<void> {
    if (this.sourcesConnectedPromise) {
      return this.sourcesConnectedPromise;
    }
    this.sourcesConnectedPromise = (async () => {
      await this.sourceRegistry.connectAll(this.profile.sources);
    })();
    return this.sourcesConnectedPromise;
  }

  async shutdown(): Promise<void> {
    await this.sourceRegistry.closeAll();
  }
}
