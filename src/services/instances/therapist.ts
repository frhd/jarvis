/**
 * Therapist service instances (lazy-loaded)
 *
 * Provides lazy getters for therapist services to avoid circular dependencies.
 * Returns null when therapist mode is disabled via feature flags.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import type { TherapistService } from '../therapist/therapist.service';
import type { DyadDetectorService } from '../therapist/dyad-detector.service';
import type { ConsentManagerService } from '../therapist/consent-manager.service';
import type { EmotionalAnalyzerService } from '../therapist/emotional-analyzer.service';
import type { InterventionEngineService } from '../therapist/intervention-engine.service';
import type { ResponseGeneratorService } from '../therapist/response-generator.service';
import type { DyadContextService } from '../therapist/dyad-context.service';

/** Sentinel value to distinguish "not yet loaded" from "loaded as null" */
const NOT_LOADED = Symbol('NOT_LOADED');

let _therapistService: TherapistService | null | typeof NOT_LOADED = NOT_LOADED;
let _dyadDetectorService: DyadDetectorService | null | typeof NOT_LOADED = NOT_LOADED;
let _consentManagerService: ConsentManagerService | null | typeof NOT_LOADED = NOT_LOADED;
let _emotionalAnalyzerService: EmotionalAnalyzerService | null | typeof NOT_LOADED = NOT_LOADED;
let _interventionEngineService: InterventionEngineService | null | typeof NOT_LOADED = NOT_LOADED;
let _responseGeneratorService: ResponseGeneratorService | null | typeof NOT_LOADED = NOT_LOADED;
let _dyadContextBuilderService: DyadContextService | null | typeof NOT_LOADED = NOT_LOADED;

export function getTherapistService(): TherapistService | null {
  if (_therapistService === NOT_LOADED) {
    const { therapistService } = require('../factory/index');
    _therapistService = therapistService ?? null;
  }
  return _therapistService as TherapistService | null;
}

export function getDyadDetectorService(): DyadDetectorService | null {
  if (_dyadDetectorService === NOT_LOADED) {
    const { dyadDetectorService } = require('../factory/index');
    _dyadDetectorService = dyadDetectorService ?? null;
  }
  return _dyadDetectorService as DyadDetectorService | null;
}

export function getConsentManagerService(): ConsentManagerService | null {
  if (_consentManagerService === NOT_LOADED) {
    const { consentManagerService } = require('../factory/index');
    _consentManagerService = consentManagerService ?? null;
  }
  return _consentManagerService as ConsentManagerService | null;
}

export function getEmotionalAnalyzerService(): EmotionalAnalyzerService | null {
  if (_emotionalAnalyzerService === NOT_LOADED) {
    const { emotionalAnalyzerService } = require('../factory/index');
    _emotionalAnalyzerService = emotionalAnalyzerService ?? null;
  }
  return _emotionalAnalyzerService as EmotionalAnalyzerService | null;
}

export function getInterventionEngineService(): InterventionEngineService | null {
  if (_interventionEngineService === NOT_LOADED) {
    const { interventionEngineService } = require('../factory/index');
    _interventionEngineService = interventionEngineService ?? null;
  }
  return _interventionEngineService as InterventionEngineService | null;
}

export function getResponseGeneratorService(): ResponseGeneratorService | null {
  if (_responseGeneratorService === NOT_LOADED) {
    const { responseGeneratorService } = require('../factory/index');
    _responseGeneratorService = responseGeneratorService ?? null;
  }
  return _responseGeneratorService as ResponseGeneratorService | null;
}

export function getDyadContextBuilderService(): DyadContextService | null {
  if (_dyadContextBuilderService === NOT_LOADED) {
    const { dyadContextBuilderService } = require('../factory/index');
    _dyadContextBuilderService = dyadContextBuilderService ?? null;
  }
  return _dyadContextBuilderService as DyadContextService | null;
}

/**
 * Reset all therapist service instances (for testing)
 */
export function resetTherapistServices(): void {
  _therapistService = NOT_LOADED;
  _dyadDetectorService = NOT_LOADED;
  _consentManagerService = NOT_LOADED;
  _emotionalAnalyzerService = NOT_LOADED;
  _interventionEngineService = NOT_LOADED;
  _responseGeneratorService = NOT_LOADED;
  _dyadContextBuilderService = NOT_LOADED;
}
