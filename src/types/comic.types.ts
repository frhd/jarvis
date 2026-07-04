/**
 * Comic Module Types
 *
 * Types for the Comic Module that generates personalized, high-quality jokes
 * with anti-repetition tracking.
 */

// ============================================================================
// Joke Styles
// ============================================================================

/**
 * Different joke styles that can be generated
 */
export type JokeStyle =
  | 'dad_joke'     // Wholesome, corny, so-bad-it's-good
  | 'punny'        // Wordplay, double meanings, linguistic twists
  | 'clever'       // Requires thinking, smart humor
  | 'one_liner'    // Quick punchlines, under 30 words
  | 'absurdist'    // Surreal, unexpected, subverts expectations
  | 'story'        // Mini narrative with setup and payoff
  | 'mixed';       // Random combination

/**
 * Categories for jokes based on topics
 */
export type JokeCategory =
  | 'general'      // Universal topics
  | 'tech'         // Programming, computers, tech humor
  | 'science'      // Science, math, physics
  | 'wordplay';    // Pure wordplay jokes

/**
 * User reactions to jokes (for learning preferences)
 */
export type UserReaction =
  | 'laughed'           // User laughed (emoji reaction, "haha")
  | 'groaned'           // "ugh", "dad joke" reaction
  | 'meh'               // No reaction or neutral
  | 'requested_more';   // "another one", "more"

// ============================================================================
// Joke History Entry
// ============================================================================

/**
 * Database record for a joke told to a user
 */
export interface JokeHistoryEntry {
  id: string;
  senderId: string | null;
  chatId: string;
  jokeContent: string;
  jokeHash: string;      // SHA-256 hash for deduplication
  style: JokeStyle;
  categoryId: string;    // Reference to joke category
  userReaction: UserReaction | null;
  createdAt: Date;
}

/**
 * New joke history entry to insert
 */
export interface NewJokeHistoryEntry {
  id?: string;
  senderId: string | null;
  chatId: string;
  jokeContent: string;
  jokeHash: string;
  style: JokeStyle;
  categoryId: string;
  userReaction?: UserReaction | null;
  createdAt?: Date;
}

// ============================================================================
// Joke Generation Context
// ============================================================================

/**
 * Context for generating a personalized joke
 */
export interface JokeGenerationContext {
  senderId: string | null;
  chatId: string;
  senderName?: string;
  recentTopics?: string[];          // Topics from recent conversation
  excludedJokeHashes?: string[];    // Hashes of recent jokes to avoid
  preferredStyle?: JokeStyle;       // User's preferred style (if known)
  preferredCategories?: JokeCategory[];  // User's preferred categories
  styleHint?: JokeStyle;            // Style hint from request ("tell me a dad joke")
}

/**
 * Result from joke generation
 */
export interface JokeGenerationResult {
  success: boolean;
  joke?: string;
  style: JokeStyle;
  category: JokeCategory;
  jokeHash: string;
  error?: string;
  durationMs?: number;
}

// ============================================================================
// Joke Statistics
// ============================================================================

/**
 * Statistics about jokes told to a user
 */
export interface JokeStats {
  totalJokes: number;
  jokesByStyle: Record<JokeStyle, number>;
  jokesByCategory: Record<JokeCategory, number>;
  reactionsByType: Record<UserReaction, number>;
  lastJokeAt: Date | null;
  favoriteStyle: JokeStyle | null;    // Most common style with positive reaction
  favoriteCategory: JokeCategory | null;  // Most common category with positive reaction
}

// ============================================================================
// Style Detection
// ============================================================================

/**
 * Mapping of keywords to joke styles for style hint detection
 */
export const JOKE_STYLE_KEYWORDS: Record<JokeStyle, RegExp[]> = {
  dad_joke: [
    /\bdad\s*joke/i,
    /\bcorn(y|ball)/i,
    /\bwholesome/i,
    /\bcheesy/i,
    /\bpun(ny)?/i,
  ],
  punny: [
    /\bpun(ny)?/i,
    /\bwordplay/i,
    /\bplay\s*on\s*words/i,
  ],
  clever: [
    /\bclever/i,
    /\bsmart/i,
    /\bwitty/i,
    /\bintellectual/i,
    /\bthink/i,
    // Specific comedians known for clever/witty humor
    /\blouis\s+ck/i,
    /\blouis\s+c\.?k\.?/i,
    /\bdave\s+chappelle/i,
    /\bgeorge\s+carlin/i,
  ],
  one_liner: [
    /\bshort/i,
    /\bquick/i,
    /\b(one|1)\s*liner/i,
    /\bbrief/i,
  ],
  absurdist: [
    /\babsurd/i,
    /\bsurreal/i,
    /\bwild/i,
    /\bout\s*there/i,
    /\brandom/i,
    /\bweird/i,
  ],
  story: [
    /\bstor(y|ies)/i,
    /\blong/i,
    /\bnarrative/i,
    /\bsetup/i,
  ],
  mixed: [],
};

/**
 * System prompts for each joke style
 */
export const JOKE_STYLE_PROMPTS: Record<JokeStyle, string> = {
  dad_joke: `You are a master of dad jokes. Generate a wholesome, corny joke that's so bad it's good.
Characteristics:
- Simple wordplay or obvious puns
- Wholesome and family-friendly
- Elicits a groan as much as a laugh
- Classic "Hi X, I'm Dad" energy
Keep it short (1-3 sentences max).`,

  punny: `You are a master of wordplay and puns. Generate a clever pun-based joke.
Characteristics:
- Double meanings and linguistic twists
- Creative wordplay that makes people think
- Unexpected connections between words
- Clever use of homophones or similar-sounding words
Keep it short (1-3 sentences max).`,

  clever: `You are a master of intelligent humor. Generate a clever joke that requires thinking.
Characteristics:
- Requires a moment of thought to get
- Smart observations about life, logic, or human nature
- Might involve irony or clever misdirection
- Rewards the listener for getting it
Keep it short (1-3 sentences max).`,

  one_liner: `You are a master of quick comedy. Generate a sharp one-liner joke.
Characteristics:
- Under 30 words total
- Quick setup and immediate punchline
- Punchy and memorable
- Works great in text format
Keep it to just ONE sentence.`,

  absurdist: `You are a master of absurdist humor. Generate a surreal, unexpected joke.
Characteristics:
- Subverts expectations in surprising ways
- Surreal or unexpected imagery
- May be slightly nonsensical but still funny
- Think "Monty Python" style humor
Keep it short (1-3 sentences max).`,

  story: `You are a master of narrative comedy. Generate a mini story joke.
Characteristics:
- Brief narrative with setup and payoff
- Engaging mini-story with a twist ending
- Builds anticipation then surprises
- Like a tiny comedy sketch
Keep it under 5 sentences.`,

  mixed: `You are a comedy genius. Generate a funny joke in any style you think works best.
Be creative and surprise the listener. Keep it short and punchy (1-4 sentences).`,
};

/**
 * Category-specific additions to prompts
 */
export const JOKE_CATEGORY_PROMPTS: Record<JokeCategory, string> = {
  general: '',
  tech: `\nThe joke should relate to programming, computers, technology, or tech culture. Think developer humor, coding jokes, or IT struggles.`,
  science: `\nThe joke should relate to science, math, physics, chemistry, or scientific concepts. Educational but funny.`,
  wordplay: `\nThe joke should be centered around wordplay, puns, or linguistic humor. Focus on clever use of language.`,
};
