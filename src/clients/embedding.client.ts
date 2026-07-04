import { logger } from '../utils/logger.js';

export interface EmbeddingConfig {
  baseUrl: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  totalDuration?: number;
}

export interface EmbeddingHealthStatus {
  healthy: boolean;
  model: string;
  error?: string;
}

/** Health check timeout in milliseconds */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

export class EmbeddingClient {
  private config: EmbeddingConfig;

  constructor(config: Partial<EmbeddingConfig> & Pick<EmbeddingConfig, 'baseUrl' | 'timeoutMs'>) {
    this.config = {
      model: config.model ?? 'nomic-embed-text',
      dimensions: config.dimensions ?? 768,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
    };
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          input: text,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Ollama returns embeddings as an array, even for single input
      const embedding = data.embeddings?.[0];
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response format');
      }

      // Validate embedding dimensions match expected configuration
      if (embedding.length !== this.config.dimensions) {
        logger.warn('[EmbeddingClient] Dimension mismatch detected', {
          expected: this.config.dimensions,
          actual: embedding.length,
          model: data.model,
        });
        // Log warning but don't fail - allow the system to use actual dimensions
      }

      return {
        embedding,
        model: data.model,
        totalDuration: data.total_duration,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Embedding request timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResponse[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          input: texts,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Ollama returns embeddings as an array
      const embeddings = data.embeddings;
      if (!embeddings || !Array.isArray(embeddings)) {
        throw new Error('Invalid batch embedding response format');
      }

      // Map each embedding to EmbeddingResponse format
      return embeddings.map((embedding: number[]) => ({
        embedding,
        model: data.model,
        totalDuration: data.total_duration,
      }));
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Batch embedding request timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
    }
  }

  async healthCheck(): Promise<EmbeddingHealthStatus> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        return { healthy: false, model: this.config.model, error: 'Ollama not responding' };
      }

      const data = await response.json();
      const modelLoaded = data.models?.some(
        (m: { name: string }) => m.name.includes(this.config.model.split(':')[0])
      );

      return {
        healthy: true,
        model: this.config.model,
        error: modelLoaded ? undefined : 'Model not loaded (will load on first request)',
      };
    } catch (error) {
      return {
        healthy: false,
        model: this.config.model,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
