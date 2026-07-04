/**
 * Emotional Analyzer Service
 *
 * Analyzes emotional patterns in messages for dyad participants.
 */

import { logger } from '../../utils/logger.js';
import { nanoid } from 'nanoid';
import type {
  EmotionAnalysis,
  EmotionCategory,
  EmotionTrend,
  ParticipantEmotionalState,
} from './types.js';
import type { Message } from '../../types/index.js';

/** Maximum messages to analyze for emotional state */
const EMOTION_ANALYSIS_MESSAGE_LIMIT = 20;

/** Hours before emotion state is considered stale */
const EMOTION_STATE_STALE_HOURS = 1;

/** Milliseconds in an hour */
const MS_PER_HOUR = 1000 * 60 * 60;

/** Default intensity for neutral emotion (0-100) */
const NEUTRAL_INTENSITY = 50;

/** Default confidence for neutral emotion */
const NEUTRAL_CONFIDENCE = 0.5;

/** Negation modifier (reduces emotion score) */
const NEGATION_MODIFIER = 0.3;

/** Amplifier modifier (increases emotion score) */
const AMPLIFIER_MODIFIER = 1.5;

/** Diminisher modifier (reduces emotion score) */
const DIMINISHER_MODIFIER = 0.6;

/** Minimum recency weight for emotion scoring */
const MIN_RECENCY_WEIGHT = 0.5;

/** Hours for recency weight calculation (24 hours = 1 day) */
const RECENCY_WEIGHT_PERIOD_HOURS = 24;

/** Threshold ratio for mixed emotion detection */
const MIXED_EMOTION_RATIO_THRESHOLD = 0.5;

/** Minimum score for strong emotion detection */
const STRONG_EMOTION_MIN_SCORE = 1;

/** Multiplier for calculating intensity from score */
const INTENSITY_MULTIPLIER = 10;

/** Divisor for calculating confidence from score */
const CONFIDENCE_DIVISOR = 10;

/** Maximum number of emotion indicators to return */
const MAX_EMOTION_INDICATORS = 10;

/** Intensity difference threshold for improving trend (0-100) */
const INTENSITY_DIFF_IMPROVING = 10;

/** Intensity difference threshold for declining trend (0-100) */
const INTENSITY_DIFF_DECLINING = 10;

/** Intensity difference threshold for volatile trend (0-100) */
const INTENSITY_DIFF_VOLATILE = 20;

// Emotion keyword patterns
const EMOTION_PATTERNS: Record<EmotionCategory, RegExp[]> = {
  joy: [
    /\b(happy|joy|excited|wonderful|amazing|great|love|loved|loving|grateful|blessed|thrilled|elated)\b/i,
    /\b(smile|smiling|laugh|laughing|lol|haha|hehe)\b/i,
    /❤️|💕|😊|😄|🥰|🎉/,
  ],
  sadness: [
    /\b(sad|unhappy|depressed|down|blue|miserable|heartbroken|devastated|disappointed|hurt)\b/i,
    /\b(cry|crying|tears|weep|sob)\b/i,
    /😢|😭|😞|💔|😔/,
  ],
  anger: [
    /\b(angry|mad|furious|outraged|frustrated|annoyed|irritated|pissed|rage|hostile)\b/i,
    /\b(hate|hatred|loathe|despise)\b/i,
    /😠|😡|🤬|💢/,
  ],
  fear: [
    /\b(afraid|scared|terrified|anxious|worried|nervous|panic|dread|frightened|apprehensive)\b/i,
    /\b(uncertain|unsure|insecure|vulnerable)\b/i,
    /😨|😰|😱|😟/,
  ],
  surprise: [
    /\b(surprised|shocked|amazed|astonished|stunned|unexpected|wow|omg|unbelievable)\b/i,
    /😲|🤯|😮|😯/,
  ],
  disgust: [
    /\b(disgusted|repulsed|revolted|sick|nauseated|gross|yuck)\b/i,
    /🤢|🤮|😖|😩/,
  ],
  neutral: [],
  mixed: [],
};

// Intensity modifiers
const INTENSITY_MODIFIERS = {
  amplifiers: /\b(very|really|so|extremely|incredibly|absolutely|totally|completely|utterly)\b/i,
  diminishers: /\b(a bit|a little|somewhat|kind of|sort of|slightly|fairly|rather)\b/i,
  negators: /\b(not|no|never|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t)\b/i,
};

import type { IEmotionalAnalyzerService } from '../../interfaces/therapist.js';
export type { IEmotionalAnalyzerService };

export class EmotionalAnalyzerService implements IEmotionalAnalyzerService {
  constructor(
    private emotionalStateRepo: {
      findByConversationAndUser(
        conversationId: string,
        userId: string
      ): Promise<{
        primaryEmotion: string;
        emotionIntensity: number;
        emotionTrend: string;
        lastAnalyzedAt: number;
        analysisData: string;
      } | null>;
      upsert(state: {
        id: string;
        conversationId: string;
        userId: string;
        primaryEmotion: string;
        emotionIntensity: number;
        emotionTrend: string;
        lastAnalyzedAt: number;
        analysisData: string;
      }): Promise<void>;
    }
  ) {}

  /**
   * Analyze emotional state from messages
   */
  analyzeEmotion(messages: Message[]): EmotionAnalysis {
    if (messages.length === 0) {
      return {
        primaryEmotion: 'neutral',
        intensity: NEUTRAL_INTENSITY,
        trend: 'stable',
        confidence: NEUTRAL_CONFIDENCE,
        indicators: [],
      };
    }

    const emotionScores: Record<EmotionCategory, number> = {
      joy: 0,
      sadness: 0,
      anger: 0,
      fear: 0,
      surprise: 0,
      disgust: 0,
      neutral: 0,
      mixed: 0,
    };

    const indicators: string[] = [];

    // Analyze each message
    for (const msg of messages) {
      const text = msg.text || '';
      if (!text.trim()) continue;

      // Check for negation context
      const hasNegator = INTENSITY_MODIFIERS.negators.test(text);
      const hasAmplifier = INTENSITY_MODIFIERS.amplifiers.test(text);
      const hasDiminisher = INTENSITY_MODIFIERS.diminishers.test(text);

      // Score each emotion category
      for (const [emotion, patterns] of Object.entries(EMOTION_PATTERNS)) {
        if (emotion === 'neutral' || emotion === 'mixed') continue;

        for (const pattern of patterns) {
          const matches = text.match(pattern);
          if (matches) {
            let score = matches.length;

            // Apply modifiers
            if (hasNegator) score *= NEGATION_MODIFIER;
            if (hasAmplifier) score *= AMPLIFIER_MODIFIER;
            if (hasDiminisher) score *= DIMINISHER_MODIFIER;

            // More recent messages have higher weight
            const messageAge = Date.now() - msg.createdAt.getTime();
            const recencyWeight = Math.max(MIN_RECENCY_WEIGHT, 1 - messageAge / (MS_PER_HOUR * RECENCY_WEIGHT_PERIOD_HOURS));
            score *= recencyWeight;

            emotionScores[emotion as EmotionCategory] += score;
            indicators.push(`${emotion}: ${matches[0]}`);
          }
        }
      }
    }

    // Find primary emotion
    let primaryEmotion: EmotionCategory = 'neutral';
    let maxScore = 0;

    for (const [emotion, score] of Object.entries(emotionScores)) {
      if (score > maxScore) {
        maxScore = score;
        primaryEmotion = emotion as EmotionCategory;
      }
    }

    // Check for mixed emotions (multiple strong emotions)
    const strongEmotions = Object.entries(emotionScores)
      .filter(([_, score]) => score > maxScore * MIXED_EMOTION_RATIO_THRESHOLD && score > STRONG_EMOTION_MIN_SCORE)
      .length;

    if (strongEmotions >= 2) {
      primaryEmotion = 'mixed';
    }

    // Calculate intensity (0-100)
    const totalEmotionalScore = Object.values(emotionScores).reduce((a, b) => a + b, 0);
    const intensity = Math.min(100, Math.round(totalEmotionalScore * INTENSITY_MULTIPLIER));

    // Determine confidence based on signal strength
    const confidence = Math.min(1, totalEmotionalScore / CONFIDENCE_DIVISOR);

    return {
      primaryEmotion,
      intensity,
      trend: 'stable', // Will be updated based on historical comparison
      confidence,
      indicators: indicators.slice(0, MAX_EMOTION_INDICATORS),
    };
  }

  /**
   * Get stored emotional state for a participant
   */
  async getEmotionalState(
    conversationId: string,
    userId: string
  ): Promise<ParticipantEmotionalState | null> {
    const state = await this.emotionalStateRepo.findByConversationAndUser(conversationId, userId);

    if (!state) {
      return null;
    }

    // Check if state is stale
    const lastAnalyzedAt = new Date(state.lastAnalyzedAt * 1000);
    const hoursSinceAnalysis = (Date.now() - lastAnalyzedAt.getTime()) / MS_PER_HOUR;

    if (hoursSinceAnalysis > EMOTION_STATE_STALE_HOURS) {
      return null; // State is stale, need re-analysis
    }

    return {
      userId,
      analysis: {
        primaryEmotion: state.primaryEmotion as EmotionCategory,
        intensity: state.emotionIntensity,
        trend: state.emotionTrend as EmotionTrend,
        confidence: JSON.parse(state.analysisData).confidence || NEUTRAL_CONFIDENCE,
        indicators: JSON.parse(state.analysisData).indicators || [],
      },
      lastAnalyzedAt,
    };
  }

  /**
   * Update stored emotional state
   */
  async updateEmotionalState(
    conversationId: string,
    userId: string,
    analysis: EmotionAnalysis
  ): Promise<void> {
    // Get previous state to determine trend
    const previous = await this.emotionalStateRepo.findByConversationAndUser(
      conversationId,
      userId
    );

    let trend: EmotionTrend = 'stable';
    if (previous) {
      const prevIntensity = previous.emotionIntensity;
      const intensityDiff = analysis.intensity - prevIntensity;

      if (intensityDiff > INTENSITY_DIFF_IMPROVING) trend = 'improving';
      else if (intensityDiff < -INTENSITY_DIFF_DECLINING) trend = 'declining';
      else if (Math.abs(intensityDiff) > INTENSITY_DIFF_VOLATILE) trend = 'volatile';
    }

    analysis.trend = trend;

    await this.emotionalStateRepo.upsert({
      id: nanoid(),
      conversationId,
      userId,
      primaryEmotion: analysis.primaryEmotion,
      emotionIntensity: analysis.intensity,
      emotionTrend: analysis.trend,
      lastAnalyzedAt: Math.floor(Date.now() / 1000),
      analysisData: JSON.stringify({
        confidence: analysis.confidence,
        indicators: analysis.indicators,
      }),
    });

    logger.debug('[EmotionalAnalyzer] Updated emotional state', {
      conversationId,
      userId,
      primaryEmotion: analysis.primaryEmotion,
      intensity: analysis.intensity,
      trend: analysis.trend,
    });
  }

  /**
   * Analyze all participants in a dyad
   */
  async analyzeDyadEmotions(
    conversationId: string,
    messages: Message[]
  ): Promise<ParticipantEmotionalState[]> {
    // Group messages by user
    const messagesByUser = new Map<string, Message[]>();

    for (const msg of messages) {
      const userId = msg.senderId;
      if (!userId) continue;

      if (!messagesByUser.has(userId)) {
        messagesByUser.set(userId, []);
      }
      messagesByUser.get(userId)!.push(msg);
    }

    const states: ParticipantEmotionalState[] = [];

    for (const [userId, userMessages] of messagesByUser) {
      // Check for cached state first
      const cached = await this.getEmotionalState(conversationId, userId);

      if (cached) {
        states.push(cached);
        continue;
      }

      // Analyze fresh
      const analysis = this.analyzeEmotion(
        userMessages.slice(-EMOTION_ANALYSIS_MESSAGE_LIMIT)
      );

      await this.updateEmotionalState(conversationId, userId, analysis);

      states.push({
        userId,
        analysis,
        lastAnalyzedAt: new Date(),
      });
    }

    return states;
  }
}
