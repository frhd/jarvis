/**
 * Enhanced Intent Classifier Service
 * Backward compatibility re-export from the intent module.
 *
 * This file re-exports from src/services/intent/ for backward compatibility.
 * New imports should use: import { EnhancedIntentClassifierService } from '@services/intent/index.js';
 */

export {
  EnhancedIntentClassifierService,
  type EnhancedClassifierConfig,
  type IntentCategory,
  type IntentClassificationResult,
} from './intent/enhanced-intent-classifier.service.js';

// Re-export types for backward compatibility
export type { EnhancedIntentResult, LegacyIntentCategory } from './intent/enhanced-intent-classifier.service.js';
