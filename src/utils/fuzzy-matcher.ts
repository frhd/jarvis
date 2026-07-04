/**
 * Fuzzy Matcher Utility
 *
 * Provides fuzzy string matching algorithms for improved contact search.
 * Supports Levenshtein distance, phonetic matching, and name normalization.
 */

import { createLogger } from './logger.js';

const logger = createLogger('FuzzyMatcher');

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits (insertions, deletions or substitutions)
 * required to change one string into the other
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Create distance matrix
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // deletion
          dp[i][j - 1] + 1,    // insertion
          dp[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity score between two strings (0-100)
 * Uses Levenshtein distance with Jaro-Winkler-like improvement
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLen = Math.max(str1.length, str2.length);

  if (maxLen === 0) {
    return 100;
  }

  // Normalize by max length
  let similarity = ((maxLen - distance) / maxLen) * 100;

  // Boost score if one string is prefix of the other
  const shorter = str1.length < str2.length ? str1 : str2;
  const longer = str1.length >= str2.length ? str1 : str2;
  if (longer.toLowerCase().startsWith(shorter.toLowerCase())) {
    similarity = Math.min(100, similarity + 20);
  }

  return Math.round(similarity);
}

/**
 * Normalize a name for comparison
 * - Converts to lowercase
 * - Removes diacritics (ä, ö, ü → a, o, u)
 * - Removes special characters
 * - Removes extra spaces
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars except spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Calculate phonetic similarity using Soundex algorithm
 * Returns similarity score (0-100)
 */
export function phoneticSimilarity(str1: string, str2: string): number {
  const soundex1 = soundex(str1);
  const soundex2 = soundex(str2);

  // If Soundex codes match, high similarity
  if (soundex1 === soundex2) {
    return 95;
  }

  // If codes are close, medium similarity
  if (soundex1.length > 0 && soundex2.length > 0) {
    const matchCount = Math.min(
      soundex1.split('').filter((c, i) => c === soundex2[i]).length,
      soundex2.split('').filter((c, i) => c === soundex1[i]).length
    );
    const maxCode = Math.max(soundex1.length, soundex2.length);
    return Math.round((matchCount / maxCode) * 80);
  }

  return 0;
}

/**
 * American Soundex algorithm
 * Returns phonetic code for a name
 */
function soundex(name: string): string {
  if (!name) {
    return '';
  }

  // Convert to uppercase and keep only letters
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');

  if (letters.length === 0) {
    return '';
  }

  // Soundex mapping
  const mapping: Record<string, string> = {
    'A': '0', 'E': '0', 'I': '0', 'O': '0', 'U': '0', 'Y': '0',
    'B': '1', 'F': '1', 'P': '1', 'V': '1',
    'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
    'D': '3', 'T': '3',
    'L': '4',
    'M': '5', 'N': '5',
    'R': '6'
  };

  // First letter
  const firstLetter = letters[0];

  // Convert rest to digits
  let code = firstLetter;
  let previousDigit = mapping[firstLetter];

  for (let i = 1; i < letters.length; i++) {
    const digit = mapping[letters[i]];
    if (digit && digit !== previousDigit) {
      code += digit;
      previousDigit = digit;
    }
  }

  // Pad or truncate to 4 characters
  code = code.padEnd(4, '0').substring(0, 4);

  return code;
}

/**
 * Calculate combined similarity score using multiple algorithms
 * Returns comprehensive similarity score (0-100)
 */
export function calculateCombinedSimilarity(
  query: string,
  target: string,
  options?: {
    weights?: {
      levenshtein: number;
      phonetic: number;
      prefix: number;
    };
  }
): number {
  const weights = options?.weights || {
    levenshtein: 0.5,
    phonetic: 0.3,
    prefix: 0.2,
  };

  const normalizedQuery = normalizeName(query);
  const normalizedTarget = normalizeName(target);

  // Levenshtein similarity
  const levenshteinScore = calculateSimilarity(normalizedQuery, normalizedTarget);

  // Phonetic similarity
  const phoneticScore = phoneticSimilarity(query, target);

  // Prefix similarity
  const prefixScore = normalizedTarget.startsWith(normalizedQuery) ? 100 : 0;

  // Weighted combination
  const combinedScore =
    (levenshteinScore * weights.levenshtein) +
    (phoneticScore * weights.phonetic) +
    (prefixScore * weights.prefix);

  return Math.round(combinedScore);
}

/**
 * Find best matches from a list of candidates
 * Returns sorted array of matches with scores
 */
export interface MatchResult<T> {
  item: T;
  score: number;
  normalized: string;
}

export function findBestMatches<T>(
  query: string,
  candidates: T[],
  getName: (item: T) => string,
  options?: {
    minScore?: number;
    maxResults?: number;
    weights?: {
      levenshtein: number;
      phonetic: number;
      prefix: number;
    };
  }
): MatchResult<T>[] {
  const matches: MatchResult<T>[] = [];
  const minScore = options?.minScore || 50;
  const maxResults = options?.maxResults || 10;

  for (const candidate of candidates) {
    const name = getName(candidate);
    const score = calculateCombinedSimilarity(query, name, options);
    const normalized = normalizeName(name);

    if (score >= minScore) {
      matches.push({ item: candidate, score, normalized });
    }
  }

  // Sort by score (descending)
  matches.sort((a, b) => b.score - a.score);

  // Return top results
  return matches.slice(0, maxResults);
}

/**
 * FuzzyMatcher class for stateful matching operations
 */
export class FuzzyMatcher {
  private matches: Map<string, { count: number; lastSeen: Date }> = new Map();

  /**
   * Find and record a match
   */
  findMatch<T>(
    query: string,
    candidates: T[],
    getName: (item: T) => string,
    options?: {
      minScore?: number;
      maxResults?: number;
    }
  ): MatchResult<T>[] {
    const results = findBestMatches(query, candidates, getName, options);

    // Record match statistics
    const key = query.toLowerCase();
    const existing = this.matches.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = new Date();
    } else {
      this.matches.set(key, { count: 1, lastSeen: new Date() });
    }

    return results;
  }

  /**
   * Get match statistics for a query
   */
  getMatchStats(query: string): { count: number; lastSeen: Date | null } {
    const key = query.toLowerCase();
    const match = this.matches.get(key);
    return {
      count: match?.count || 0,
      lastSeen: match?.lastSeen || null,
    };
  }

  /**
   * Clear match statistics
   */
  clearStats(): void {
    this.matches.clear();
    logger.debug('[FuzzyMatcher] Statistics cleared');
  }
}
