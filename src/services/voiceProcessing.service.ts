/**
 * Voice Processing Service - Phase 6: Multi-Modal Support
 *
 * Provides speech-to-text, text-to-speech, voice activity detection,
 * audio format conversion, transcription caching, and language detection.
 */

import { createLogger } from '../utils/logger';
import { appConfig } from '../config';
import { VOICE_TRANSCRIPTION_HEALTH_CHECK_TIMEOUT_MS } from '../config/constants';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const logger = createLogger('VoiceProcessingService');

// ============================================================================
// Types
// ============================================================================

/**
 * Supported audio formats
 */
export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'm4a' | 'webm' | 'opus';

/**
 * Whisper API response format
 */
export interface WhisperTranscription {
  text: string;
  language?: string;
  duration?: number;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
}

/**
 * Segment from Whisper transcription
 */
export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  avgLogprob?: number;
  noSpeechProb?: number;
}

/**
 * Word-level timing from Whisper
 */
export interface WhisperWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

/**
 * Voice activity detection result
 */
export interface VoiceActivityResult {
  hasSpeech: boolean;
  speechProbability: number;
  segments: Array<{
    start: number;
    end: number;
    confidence: number;
  }>;
  silenceRatio: number;
}

/**
 * Transcription result with metadata
 */
export interface TranscriptionResult {
  text: string;
  language: string;
  languageConfidence: number;
  duration: number;
  segments: WhisperSegment[];
  words?: WhisperWord[];
  cached: boolean;
  processingTimeMs: number;
}

/**
 * Language detection result
 */
export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  alternatives: Array<{
    language: string;
    confidence: number;
  }>;
}

/**
 * Text-to-speech request
 */
export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  format?: AudioFormat;
}

/**
 * Text-to-speech result (success case)
 */
export interface TTSSuccessResult {
  success: true;
  audioPath: string;
  format: AudioFormat;
  duration: number;
  sampleRate: number;
}

/**
 * TTS error codes
 */
export type TTSErrorCode = 'TTS_DISABLED' | 'TTS_NOT_IMPLEMENTED' | 'TTS_API_ERROR';

/**
 * Text-to-speech error result
 */
export interface TTSErrorResult {
  success: false;
  error: {
    code: TTSErrorCode;
    message: string;
    suggestion?: string;
  };
}

/**
 * Text-to-speech result (union of success and error)
 */
export type TTSResult = TTSSuccessResult | TTSErrorResult;

/**
 * Audio metadata
 */
export interface AudioMetadata {
  duration: number;
  sampleRate: number;
  channels: number;
  bitrate: number;
  format: AudioFormat;
  size: number;
}

/**
 * Cached transcription entry
 */
interface CachedTranscription {
  transcription: TranscriptionResult;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
}

/**
 * Voice processing configuration
 */
export interface VoiceProcessingConfig {
  whisperApiUrl: string;
  whisperApiKey?: string;
  whisperModel: string;
  defaultLanguage: string;
  maxAudioDurationSeconds: number;
  cacheEnabled: boolean;
  cacheTTLMs: number;
  cacheMaxEntries: number;
  vadThreshold: number;
  ttsEnabled: boolean;
  ttsApiUrl?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: VoiceProcessingConfig = {
  // Uses whisper-asr-webservice /asr endpoint (ARM64 compatible)
  whisperApiUrl: `${appConfig.whisper?.baseUrl || 'http://localhost:9000'}/asr`,
  whisperModel: appConfig.whisper?.model || 'base',
  defaultLanguage: appConfig.whisper?.defaultLanguage || 'en',
  maxAudioDurationSeconds: appConfig.whisper?.maxAudioDurationSeconds || 300,
  cacheEnabled: true,
  cacheTTLMs: 24 * 60 * 60 * 1000, // 24 hours
  cacheMaxEntries: 1000,
  vadThreshold: 0.5,
  ttsEnabled: false,
};

// ============================================================================
// Voice Processing Service
// ============================================================================

export class VoiceProcessingService {
  private config: VoiceProcessingConfig;
  private transcriptionCache: Map<string, CachedTranscription>;
  private isHealthy: boolean = false;

  constructor(config: Partial<VoiceProcessingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.transcriptionCache = new Map();

    // Start cache cleanup interval
    if (this.config.cacheEnabled) {
      setInterval(() => this.cleanupCache(), 60 * 60 * 1000); // Every hour
    }
  }

  /**
   * Initialize the service and check health
   */
  async initialize(): Promise<void> {
    try {
      await this.healthCheck();
      logger.info('[VoiceProcessing] Service initialized', { healthy: this.isHealthy });
    } catch (error) {
      logger.warn('[VoiceProcessing] Service initialization warning', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check if the Whisper API is available
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Try to reach the whisper-asr-webservice root endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), VOICE_TRANSCRIPTION_HEALTH_CHECK_TIMEOUT_MS);

      // Extract base URL (remove /asr path)
      const baseUrl = this.config.whisperApiUrl.replace('/asr', '');
      const response = await fetch(baseUrl, {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      // Check if server is reachable
      this.isHealthy = response !== null && response.ok;

      return { healthy: this.isHealthy };
    } catch (error) {
      this.isHealthy = false;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { healthy: false, error: errorMessage };
    }
  }

  /**
   * Transcribe audio file to text using Whisper API
   */
  async transcribe(
    audioPath: string,
    options: {
      language?: string;
      prompt?: string;
      wordTimestamps?: boolean;
      responseFormat?: 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt';
    } = {}
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // Check cache first
    const cacheKey = this.generateCacheKey(audioPath, options);
    const cached = this.getCachedTranscription(cacheKey);
    if (cached) {
      logger.debug('[VoiceProcessing] Cache hit for transcription', { audioPath });
      return { ...cached.transcription, cached: true, processingTimeMs: Date.now() - startTime };
    }

    // Validate audio file exists
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    // Get audio metadata for validation
    const metadata = await this.getAudioMetadata(audioPath);
    if (metadata.duration > this.config.maxAudioDurationSeconds) {
      throw new Error(
        `Audio too long: ${metadata.duration}s exceeds max of ${this.config.maxAudioDurationSeconds}s`
      );
    }

    try {
      // Prepare form data for whisper-asr-webservice API
      // API: POST /asr?output=json&task=transcribe&language=en
      const formData = new FormData();
      const audioBuffer = fs.readFileSync(audioPath);

      // Create a File object from buffer (Node 20+ native support)
      const audioFile = new File([audioBuffer], path.basename(audioPath), {
        type: this.getMimeType(metadata.format),
      });
      formData.append('audio_file', audioFile);

      // Build URL with query parameters (whisper-asr-webservice format)
      const url = new URL(this.config.whisperApiUrl);
      url.searchParams.set('output', 'json');
      url.searchParams.set('task', 'transcribe');
      if (options.language) {
        url.searchParams.set('language', options.language);
      }
      if (options.wordTimestamps) {
        url.searchParams.set('word_timestamps', 'true');
      }

      const headers: Record<string, string> = {};
      if (this.config.whisperApiKey) {
        headers['Authorization'] = `Bearer ${this.config.whisperApiKey}`;
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
      }

      const whisperResponse: WhisperTranscription = await response.json();

      const result: TranscriptionResult = {
        text: whisperResponse.text,
        language: whisperResponse.language || options.language || this.config.defaultLanguage,
        languageConfidence: 0.9, // Whisper is generally confident
        duration: whisperResponse.duration || metadata.duration,
        segments: whisperResponse.segments || [],
        words: whisperResponse.words,
        cached: false,
        processingTimeMs: Date.now() - startTime,
      };

      // Cache the result
      if (this.config.cacheEnabled) {
        this.cacheTranscription(cacheKey, result);
      }

      logger.info('[VoiceProcessing] Transcription completed', {
        audioPath,
        duration: result.duration,
        textLength: result.text.length,
        processingTimeMs: result.processingTimeMs,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[VoiceProcessing] Transcription failed', { audioPath, error: errorMessage });
      throw error;
    }
  }

  /**
   * Detect speech activity in audio file
   */
  async detectVoiceActivity(audioPath: string): Promise<VoiceActivityResult> {
    // For now, we use transcription with segment info to detect speech
    // In a production system, this could use a dedicated VAD model
    try {
      const transcription = await this.transcribe(audioPath, { responseFormat: 'verbose_json' });

      const segments = transcription.segments.map((seg) => ({
        start: seg.start,
        end: seg.end,
        confidence: seg.noSpeechProb ? 1 - seg.noSpeechProb : 0.8,
      }));

      // Calculate silence ratio
      const totalDuration = transcription.duration;
      const speechDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      const silenceRatio = 1 - speechDuration / totalDuration;

      // Calculate average speech probability
      const avgConfidence =
        segments.length > 0
          ? segments.reduce((sum, seg) => sum + seg.confidence, 0) / segments.length
          : 0;

      return {
        hasSpeech: transcription.text.trim().length > 0 && avgConfidence > this.config.vadThreshold,
        speechProbability: avgConfidence,
        segments,
        silenceRatio,
      };
    } catch (error) {
      logger.error('[VoiceProcessing] VAD failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        hasSpeech: false,
        speechProbability: 0,
        segments: [],
        silenceRatio: 1,
      };
    }
  }

  /**
   * Detect language from audio
   */
  async detectLanguage(audioPath: string): Promise<LanguageDetectionResult> {
    try {
      // Use transcription to detect language
      const transcription = await this.transcribe(audioPath, { responseFormat: 'verbose_json' });

      return {
        language: transcription.language,
        confidence: transcription.languageConfidence,
        alternatives: [], // Whisper doesn't provide alternatives directly
      };
    } catch (error) {
      logger.error('[VoiceProcessing] Language detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        language: this.config.defaultLanguage,
        confidence: 0,
        alternatives: [],
      };
    }
  }

  /**
   * Convert audio to a different format
   * Note: Requires ffmpeg to be installed for actual conversion
   */
  async convertFormat(
    inputPath: string,
    outputFormat: AudioFormat,
    options: {
      sampleRate?: number;
      channels?: number;
      bitrate?: number;
    } = {}
  ): Promise<string> {
    const outputDir = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${baseName}.${outputFormat}`);

    // Build ffmpeg command
    const args = ['-i', inputPath, '-y'];

    if (options.sampleRate) {
      args.push('-ar', options.sampleRate.toString());
    }
    if (options.channels) {
      args.push('-ac', options.channels.toString());
    }
    if (options.bitrate) {
      args.push('-b:a', `${options.bitrate}k`);
    }

    args.push(outputPath);

    try {
      const { spawn } = await import('child_process');

      return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', args);

        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            logger.info('[VoiceProcessing] Audio converted', { inputPath, outputPath, outputFormat });
            resolve(outputPath);
          } else {
            reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
          }
        });

        ffmpeg.on('error', (err) => {
          reject(new Error(`FFmpeg spawn error: ${err.message}`));
        });
      });
    } catch (error) {
      logger.error('[VoiceProcessing] Audio conversion failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get audio file metadata
   */
  async getAudioMetadata(audioPath: string): Promise<AudioMetadata> {
    const stats = fs.statSync(audioPath);
    const ext = path.extname(audioPath).slice(1).toLowerCase() as AudioFormat;

    // Try to use ffprobe for accurate metadata
    try {
      const { spawn } = await import('child_process');

      return new Promise((resolve, reject) => {
        const ffprobe = spawn('ffprobe', [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format',
          '-show_streams',
          audioPath,
        ]);

        let stdout = '';
        ffprobe.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ffprobe.on('close', (code) => {
          if (code === 0) {
            try {
              const info = JSON.parse(stdout);
              const format = info.format || {};
              const audioStream = (info.streams || []).find(
                (s: { codec_type?: string }) => s.codec_type === 'audio'
              );

              resolve({
                duration: parseFloat(format.duration) || 0,
                sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : 44100,
                channels: audioStream?.channels || 2,
                bitrate: format.bit_rate ? parseInt(format.bit_rate) / 1000 : 128,
                format: ext,
                size: stats.size,
              });
            } catch {
              resolve(this.getBasicMetadata(audioPath, stats, ext));
            }
          } else {
            resolve(this.getBasicMetadata(audioPath, stats, ext));
          }
        });

        ffprobe.on('error', () => {
          resolve(this.getBasicMetadata(audioPath, stats, ext));
        });
      });
    } catch {
      return this.getBasicMetadata(audioPath, stats, ext);
    }
  }

  /**
   * Text-to-speech conversion (placeholder for future implementation)
   * Returns error result instead of throwing to allow graceful handling
   */
  async textToSpeech(request: TTSRequest): Promise<TTSResult> {
    if (!this.config.ttsEnabled) {
      logger.warn('[VoiceProcessing] TTS request received but TTS is disabled', {
        textLength: request.text.length,
      });
      return {
        success: false,
        error: {
          code: 'TTS_DISABLED',
          message: 'Text-to-speech is not enabled',
          suggestion: 'Set ttsEnabled=true in VoiceProcessingConfig or TTS_ENABLED=true in environment',
        },
      };
    }

    // Placeholder - would integrate with TTS API (OpenAI, ElevenLabs, etc.)
    logger.warn('[VoiceProcessing] TTS not yet implemented', {
      textLength: request.text.length,
      voice: request.voice,
    });
    return {
      success: false,
      error: {
        code: 'TTS_NOT_IMPLEMENTED',
        message: 'Text-to-speech is not yet implemented',
        suggestion: 'TTS integration with OpenAI, ElevenLabs, or similar API is planned for future release',
      },
    };
  }

  /**
   * Get service health status
   */
  getHealthStatus(): { healthy: boolean; cacheSize: number; cacheHitRate: number } {
    return {
      healthy: this.isHealthy,
      cacheSize: this.transcriptionCache.size,
      cacheHitRate: this.calculateCacheHitRate(),
    };
  }

  /**
   * Clear transcription cache
   */
  clearCache(): void {
    this.transcriptionCache.clear();
    logger.info('[VoiceProcessing] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    totalAccesses: number;
    oldestEntry: Date | null;
  } {
    let totalAccesses = 0;
    let oldestEntry: Date | null = null;

    for (const entry of this.transcriptionCache.values()) {
      totalAccesses += entry.accessCount;
      if (!oldestEntry || entry.createdAt < oldestEntry) {
        oldestEntry = entry.createdAt;
      }
    }

    return {
      size: this.transcriptionCache.size,
      hitRate: this.calculateCacheHitRate(),
      totalAccesses,
      oldestEntry,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Generate cache key from audio file and options
   */
  private generateCacheKey(audioPath: string, options: object): string {
    const stats = fs.statSync(audioPath);
    const content = `${audioPath}:${stats.size}:${stats.mtimeMs}:${JSON.stringify(options)}`;
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cached transcription
   */
  private getCachedTranscription(key: string): CachedTranscription | null {
    const cached = this.transcriptionCache.get(key);
    if (!cached) return null;

    // Check if expired
    if (Date.now() - cached.createdAt.getTime() > this.config.cacheTTLMs) {
      this.transcriptionCache.delete(key);
      return null;
    }

    // Update access info
    cached.accessedAt = new Date();
    cached.accessCount++;

    return cached;
  }

  /**
   * Cache a transcription result
   */
  private cacheTranscription(key: string, transcription: TranscriptionResult): void {
    // Evict old entries if cache is full
    if (this.transcriptionCache.size >= this.config.cacheMaxEntries) {
      this.evictOldestEntries(Math.floor(this.config.cacheMaxEntries * 0.1));
    }

    this.transcriptionCache.set(key, {
      transcription,
      createdAt: new Date(),
      accessedAt: new Date(),
      accessCount: 1,
    });
  }

  /**
   * Evict oldest entries from cache
   */
  private evictOldestEntries(count: number): void {
    const entries = Array.from(this.transcriptionCache.entries())
      .sort((a, b) => a[1].accessedAt.getTime() - b[1].accessedAt.getTime());

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.transcriptionCache.delete(entries[i][0]);
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.transcriptionCache.entries()) {
      if (now - entry.createdAt.getTime() > this.config.cacheTTLMs) {
        this.transcriptionCache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('[VoiceProcessing] Cache cleanup', { removed, remaining: this.transcriptionCache.size });
    }
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    let totalAccesses = 0;
    let hits = 0;

    for (const entry of this.transcriptionCache.values()) {
      totalAccesses += entry.accessCount;
      hits += entry.accessCount - 1; // First access is not a hit
    }

    return totalAccesses > 0 ? hits / totalAccesses : 0;
  }

  /**
   * Get MIME type for audio format
   */
  private getMimeType(format: AudioFormat): string {
    const mimeTypes: Record<AudioFormat, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      m4a: 'audio/m4a',
      webm: 'audio/webm',
      opus: 'audio/opus',
    };
    return mimeTypes[format] || 'audio/mpeg';
  }

  /**
   * Get basic metadata without ffprobe
   */
  private getBasicMetadata(
    audioPath: string,
    stats: fs.Stats,
    format: AudioFormat
  ): AudioMetadata {
    // Estimate duration based on file size and typical bitrate
    const avgBitrate = 128; // kbps
    const estimatedDuration = (stats.size * 8) / (avgBitrate * 1000);

    return {
      duration: estimatedDuration,
      sampleRate: 44100,
      channels: 2,
      bitrate: avgBitrate,
      format,
      size: stats.size,
    };
  }
}
