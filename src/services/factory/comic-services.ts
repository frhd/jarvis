/**
 * Comic Services Factory
 *
 * Instantiates and exports Comic Module services including:
 * - ComicGeneratorService for personalized joke generation
 */

import { ComicGeneratorService } from '../comic/comic-generator.service.js';
import { jokeHistoryRepository } from '../../repositories/jokeHistory.repository.js';
import { claudeClient } from './ai-services.js';

// Comic generator service for joke generation
export const comicGeneratorService = new ComicGeneratorService(
  claudeClient,
  jokeHistoryRepository,
  {
    recentJokesLimit: 50,
    defaultStyle: 'mixed',
    defaultCategory: 'general',
    maxResponseLength: 500,
  }
);
