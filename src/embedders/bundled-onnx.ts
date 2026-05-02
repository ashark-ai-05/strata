import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

type Pipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array }>;

type BundledOnnxOptions = {
  /** HuggingFace model id. Default: BAAI/bge-small-en-v1.5 (384-dim). */
  model?: string;
};

export class BundledOnnxEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Bundled ONNX';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };

  private readonly modelId: string;
  private extractorPromise: Promise<Pipeline> | null = null;

  constructor(options: BundledOnnxOptions = {}) {
    this.modelId = options.model ?? 'BAAI/bge-small-en-v1.5';
    this.id = `onnx-bundled:${this.modelId}`;
  }

  private async getExtractor(): Promise<Pipeline> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const transformers = await import('@huggingface/transformers');
        // Cache models locally; allow remote fetch on first run.
        transformers.env.allowRemoteModels = true;
        const extractor = await transformers.pipeline(
          'feature-extraction',
          this.modelId
        );
        return extractor as unknown as Pipeline;
      })();
    }
    return this.extractorPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getExtractor();
    const out: Float32Array[] = [];
    for (const text of texts) {
      const result = await extractor(text, { pooling: 'mean', normalize: true });
      out.push(result.data);
    }
    return out;
  }

  async probe(): Promise<EmbeddingProbeResult> {
    const t0 = performance.now();
    try {
      const v = await this.embed(['probe']);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        dims: v[0].length,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
