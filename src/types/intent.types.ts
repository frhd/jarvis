/**
 * Enhanced Intent Classification Types
 * Phase 2: Granular intent taxonomy with hierarchy and confidence thresholds
 */

// ============================================================================
// Parent Intent Categories (High-level routing)
// ============================================================================

export type ParentIntent =
  | 'greeting'       // Social interactions
  | 'question'       // Information seeking
  | 'command'        // Action requests
  | 'feedback'       // Reactions and opinions
  | 'continuation'   // Multi-turn follow-ups
  | 'plan'           // Plan workflow interactions
  | 'therapeutic';   // Therapeutic/listener mode intents

// ============================================================================
// Child Intent Categories (Granular classification)
// ============================================================================

export type GreetingIntent =
  | 'simple_greeting'    // "hi", "hello", "hey"
  | 'time_greeting'      // "good morning", "good night"
  | 'farewell'           // "bye", "see you", "talk later"
  | 'gratitude';         // "thanks", "thank you"

export type QuestionIntent =
  | 'factual_question'          // "what is X?", "who invented Y?"
  | 'how_to_question'            // "how do I...", "how can I..."
  | 'opinion_question'           // "what do you think about...", "should I..."
  | 'clarification'             // "what do you mean?", "can you explain?"
  | 'web_search_question'         // requires real-time info (weather, news, prices)
  | 'personal_question'          // "what's your name?", about the assistant
  | 'health_status';            // "health", "status", "how are you doing?" system status inquiries

export type CommandIntent =
  | 'task_request'       // "write code for...", "create a..."
  | 'search_request'     // "search for...", "find me...", "look up..."
  | 'reminder_request'   // "remind me to...", "set a reminder..."
  | 'calculation'        // "calculate...", "what is 5+5?"
  | 'translation'        // "translate X to Y"
  | 'summarization'      // "summarize this...", "tldr"
  | 'correction'         // "no, I meant...", "fix that..."
  | 'joke_request';      // "tell me a joke", "make me laugh", "cheer me up"

export type FeedbackIntent =
  | 'positive_feedback'  // "great!", "that's perfect", "thanks!"
  | 'negative_feedback'  // "that's wrong", "not what I wanted"
  | 'acknowledgment'     // "ok", "got it", "understood"
  | 'opinion_statement'  // expressing views without asking
  | 'personal_sharing';  // "I enjoy hiking", "I'm into photography"

export type ContinuationIntent =
  | 'follow_up'          // continuing previous topic
  | 'elaboration_request' // "tell me more", "go on"
  | 'topic_change'       // explicitly changing subject
  | 'reference_previous'; // "about what you said earlier..."

export type PlanIntent =
  | 'plan_propose'       // "create a plan to...", "plan how to..."
  | 'plan_feedback'      // "change X in the plan", "add Y to the plan"
  | 'plan_approve'       // "looks good", "approve the plan"
  | 'plan_execute'       // "execute", "run it", "start the loop"
  | 'plan_status'        // "what's the status?", "how's the plan?"
  | 'plan_cancel'        // "cancel the plan", "stop"
  | 'plan_list';         // "list plans", "show my plans"

export type TherapeuticIntent =
  | 'emotional_expression'  // User shares feelings
  | 'conflict_moment'       // Tension detected between participants
  | 'seeking_validation'    // Looking for acknowledgment
  | 'relationship_discussion' // Talking about their relationship
  | 'celebration_moment'    // Positive shared experience
  | 'support_request';      // One person asking for help

// Combined child intent type
export type ChildIntent =
  | GreetingIntent
  | QuestionIntent
  | CommandIntent
  | FeedbackIntent
  | ContinuationIntent
  | PlanIntent
  | TherapeuticIntent;

// ============================================================================
// Intent Hierarchy Mapping
// ============================================================================

export const INTENT_HIERARCHY: Record<ParentIntent, ChildIntent[]> = {
  greeting: ['simple_greeting', 'time_greeting', 'farewell', 'gratitude'],
  question: [
    'factual_question',
    'how_to_question',
    'opinion_question',
    'clarification',
    'web_search_question',
    'personal_question',
    'health_status',
  ],
  command: [
    'task_request',
    'search_request',
    'reminder_request',
    'calculation',
    'translation',
    'summarization',
    'correction',
    'joke_request',
  ],
  feedback: [
    'positive_feedback',
    'negative_feedback',
    'acknowledgment',
    'opinion_statement',
    'personal_sharing',
  ],
  continuation: [
    'follow_up',
    'elaboration_request',
    'topic_change',
    'reference_previous',
  ],
  plan: [
    'plan_propose',
    'plan_feedback',
    'plan_approve',
    'plan_execute',
    'plan_status',
    'plan_cancel',
    'plan_list',
  ],
  therapeutic: [
    'emotional_expression',
    'conflict_moment',
    'seeking_validation',
    'relationship_discussion',
    'celebration_moment',
    'support_request',
  ],
};

// Reverse mapping: child to parent
export const CHILD_TO_PARENT: Record<ChildIntent, ParentIntent> = Object.entries(
  INTENT_HIERARCHY
).reduce(
  (acc, [parent, children]) => {
    for (const child of children) {
      acc[child as ChildIntent] = parent as ParentIntent;
    }
    return acc;
  },
  {} as Record<ChildIntent, ParentIntent>
);

// ============================================================================
// Confidence Thresholds
// ============================================================================

export interface ConfidenceThresholds {
  high: number;      // High confidence: proceed without escalation
  medium: number;    // Medium confidence: may need context
  low: number;       // Low confidence: consider escalation
  escalate: number;  // Below this: escalate to more powerful model
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  high: 0.85,
  medium: 0.65,
  low: 0.45,
  escalate: 0.35,
};

// ============================================================================
// Classification Results
// ============================================================================

export interface EnhancedIntentResult {
  // Primary classification
  parentIntent: ParentIntent;
  childIntent: ChildIntent;
  confidence: number;

  // Confidence level
  confidenceLevel: 'high' | 'medium' | 'low' | 'uncertain';
  shouldEscalate: boolean;

  // Multi-turn context
  isFollowUp: boolean;
  referencesContext: boolean;
  suggestedContextDepth: number; // how many messages back to consider

  // Routing hints
  requiresWebSearch: boolean;
  requiresComplexReasoning: boolean;
  canUseCache: boolean;

  // Timing
  durationMs: number;
  classificationMethod: 'pattern' | 'llm' | 'escalated';
}

// Backward compatibility with old intent system
export type LegacyIntentCategory =
  | 'simple_greeting'
  | 'needs_web_search'
  | 'complex_task'
  | 'general_chat';

// ============================================================================
// Intent Routing Configuration
// ============================================================================

export interface IntentRoutingConfig {
  // Which intents can be handled by fast/local model
  fastModelIntents: ChildIntent[];

  // Which intents require the powerful model
  powerfulModelIntents: ChildIntent[];

  // Which intents require web search
  webSearchIntents: ChildIntent[];

  // Cache-eligible intents (responses can be cached)
  cacheableIntents: ChildIntent[];
}

export const DEFAULT_ROUTING_CONFIG: IntentRoutingConfig = {
  fastModelIntents: [
    'simple_greeting',
    'time_greeting',
    'farewell',
    'gratitude',
    'acknowledgment',
    'positive_feedback',
    'calculation',
    'plan_status',     // Status checks are fast lookups
    'plan_list',       // Listing plans is a fast query
  ],
  powerfulModelIntents: [
    'task_request',
    'how_to_question',
    'summarization',
    'translation',
    'opinion_question',
    'correction',
    'plan_propose',    // Plan creation requires reasoning
    'plan_feedback',   // Processing feedback requires understanding
    'joke_request',    // High-quality humor needs Claude
    // Therapeutic intents require careful, nuanced responses
    'emotional_expression',
    'conflict_moment',
    'seeking_validation',
    'relationship_discussion',
    'support_request',
  ],
  webSearchIntents: [
    'web_search_question',
    'search_request',
  ],
  cacheableIntents: [
    'simple_greeting',
    'time_greeting',
    'farewell',
    'gratitude',
    'factual_question',
    'acknowledgment',      // "ok", "got it" - generic responses
    'positive_feedback',   // "great!", "thanks!" - can use similar responses
    'calculation',         // math results are deterministic
    'how_to_question',     // generic "how to" answers can be cached
    // Note: joke_request is NOT cacheable - we want unique jokes each time
    // Note: therapeutic intents are NOT cacheable - each situation is unique
  ],
};

// ============================================================================
// Multi-turn Context Signals
// ============================================================================

export interface ConversationContextSignals {
  // Pronoun references (it, that, this, they, etc.)
  hasPronounReferences: boolean;

  // Explicit references ("as I mentioned", "about that", "earlier")
  hasExplicitReferences: boolean;

  // Continuation markers ("also", "and", "another thing")
  hasContinuationMarkers: boolean;

  // Topic coherence with previous message
  topicCoherence: number; // 0-1

  // Detected conversation flow
  conversationFlow: 'new_topic' | 'continuation' | 'clarification' | 'topic_shift';
}

// ============================================================================
// Pattern Definitions for Fast Classification
// ============================================================================

export interface IntentPattern {
  intent: ChildIntent;
  patterns: RegExp[];
  confidence: number;
  requiresContext?: boolean;
}

export const INTENT_PATTERNS: IntentPattern[] = [
  // Greetings
  {
    intent: 'simple_greeting',
    patterns: [
      /^(hi|hello|hey|yo|sup|howdy|hola|greetings?)[\s!?.]*$/i,
      /^what'?s?\s*up[\s!?.]*$/i,
      /^(hi|hello|hey)\s+(there|friend|buddy)[\s!?.]*$/i,
    ],
    confidence: 0.95,
  },
  {
    intent: 'time_greeting',
    patterns: [
      /^good\s*(morning|afternoon|evening|night)[\s!?.]*$/i,
    ],
    confidence: 0.95,
  },
  {
    intent: 'farewell',
    patterns: [
      /^(bye|goodbye|see\s*ya|later|cya|peace|take\s*care)[\s!?.]*$/i,
      /^(good\s*night|gn|talk\s*(to\s*you\s*)?later|ttyl)[\s!?.]*$/i,
    ],
    confidence: 0.95,
  },
  {
    intent: 'gratitude',
    patterns: [
      /^(thanks?|thank\s*you|thx|ty|appreciate\s*it)[\s!?.]*$/i,
      /^(thanks?\s*(a\s*lot|so\s*much))[\s!?.]*$/i,
    ],
    confidence: 0.95,
  },

  // Questions - factual
  {
    intent: 'factual_question',
    patterns: [
      /^what\s+(is|are|was|were)\s+/i,
      /^who\s+(is|are|was|were|invented|created|discovered)\s+/i,
      /^where\s+(is|are|was|were|did)\s+/i,
      /^when\s+(is|are|was|were|did)\s+/i,
      /^how\s+(many|much|old|long|far|big|tall)\s+/i,
    ],
    confidence: 0.80,
  },
  {
    intent: 'how_to_question',
    patterns: [
      /^how\s+(do|can|should|would)\s+(i|you|we)\s+/i,
      /^how\s+to\s+/i,
      /^(what'?s?\s*the\s*)?(best|easiest|fastest)\s+way\s+to\s+/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'personal_question',
    patterns: [
      /^what'?s?\s*(your|ur)\s+(name|purpose)/i,
      /^who\s+(are|r)\s+you/i,
      /^(are|r)\s+you\s+(a|an)\s*(robot|ai|bot|human|real)/i,
      /^what\s+(can|do)\s+you\s+do/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'health_status',
    patterns: [
      /^\/(health|status|h)$/i,
      /^how'?s?\s+(are\s+you|you\s+doing|is\s+everything|is\s+the\s+system)\s*(going|doing|working)/i,
      /^system\s*(status|health|check)/i,
      /^(are\s+you|is\s+everything)\s+(ok|working|fine|healthy)/i,
      // Fix: Add pattern to match /status command
      /^\/status/i,
      // Pattern: standalone "status", "health check", "check status"
      /^(status|health\s*check|check\s*status)$/i,
    ],
    confidence: 0.95,
  },

  // Web search triggers
  {
    intent: 'web_search_question',
    patterns: [
      /\b(weather|forecast|temperature)\s*(in|for|at)?\b/i,
      /\b(current|today'?s?|latest|recent)\s*(news|price|stock|score)\b/i,
      /\bwho\s*won\s*(the|last|yesterday)/i,
      /\bwhat\s*time\s*is\s*it\s*in\b/i,
      // News and current events patterns
      /\bwhat'?s?\s*(going\s*on|happening)\s*(in|with|around)?\s*(the\s*)?(world|news|today)?/i,
      /\b(news|headlines)\s*(about|on|from|in|for)\s+/i,
      /\bwhat'?s?\s*(the\s*)?(latest|new|news)\s*(in|on|about|with)?\b/i,
      /\bwhat'?s?\s*new\s*(in|with|on)\s+/i,
      /\b(tell|give)\s*me\s*(the\s*)?(news|headlines|updates)/i,
      /\bwhat'?s?\s*cooking\s*(in|with)?\b/i, // Colloquial "what's cooking in X"
      /\b(update|updates)\s*(on|about|from)\s+/i,
      /\b(happened|happening)\s*(in|to|with|at)\s+/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'search_request',
    patterns: [
      /^(search|google|look\s*up|find)\s*(for|me)?\s+/i,
    ],
    confidence: 0.90,
  },

  // Feedback
  {
    intent: 'positive_feedback',
    patterns: [
      /^(great|perfect|awesome|excellent|nice|cool|good\s*job)[\s!?.]*$/i,
      /^that'?s?\s*(great|perfect|awesome|exactly|right)[\s!?.]*$/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'negative_feedback',
    patterns: [
      /^(no|nope|wrong|incorrect|that'?s?\s*not\s*(right|correct|it))[\s!?.]*$/i,
      /^not\s*what\s*i\s*(meant|wanted|asked)/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'acknowledgment',
    patterns: [
      /^(ok|okay|k|got\s*it|understood|alright|sure|yep|yeah|yes)[\s!?.]*$/i,
      /^(sounds?\s*good|makes?\s*sense)[\s!?.]*$/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'personal_sharing',
    patterns: [
      // Name introductions (high priority for multi-turn context)
      /^(hi|hello|hey)[\s!,]+.*my name is \w+/i, // "Hi! My name is Alex"
      /my name is \w+/i, // "my name is Alex"
      /^i'm \w+[,.]?\s*(nice to meet|pleased to meet)?/i, // "I'm Alex" or "I'm Alex, nice to meet you"
      /call me \w+/i, // "call me Alex"
      // Direct preferences - "I enjoy/like/love X"
      /^i\s+(really\s+)?(enjoy|like|love|prefer|adore)\s+.+/i,
      /^i\s+(don't|do\s*not)\s+(really\s+)?(like|enjoy)\s+.+/i,
      // Hobby/interest statements
      /^i('m|\s+am)\s+(really\s+)?(into|fond\s+of|passionate\s+about|interested\s+in)\s+/i,
      /^(my\s+)?(favorite|favourite)\s+(thing|hobby|activity|pastime|sport)\s+/i,
      // Self-disclosure patterns
      /^i('ve|\s+have)\s+(always|never|recently|lately)\s+(been|enjoyed|liked|loved)\s+/i,
      /^i\s+(usually|always|often|sometimes)\s+(go|do|play|watch|read|listen)\s+/i,
      // Personal facts
      /^i\s+(work|live|study|grew\s+up)\s+(in|at|as|near)\s+/i,
      /^i('m|\s+am)\s+(a|an)\s+\w+\s+(person|type|fan|lover|enthusiast)/i,
    ],
    confidence: 0.90, // Increased for name introductions
  },

  // Continuation signals
  {
    intent: 'elaboration_request',
    patterns: [
      /^(tell\s*me\s*more|go\s*on|continue|more\s*(details?|info))[\s!?.]*$/i,
      /^(and|what\s*else|anything\s*else)[\s!?.]*$/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'clarification',
    patterns: [
      /^(what\s*do\s*you\s*mean|can\s*you\s*explain|i\s*don'?t\s*understand)[\s!?.]*$/i,
      /^(huh|what|sorry)\?+$/i,
    ],
    confidence: 0.85,
    requiresContext: true,
  },
  // Unclear/minimal input patterns (don't require context)
  {
    intent: 'clarification',
    patterns: [
      /^[?!.…]+$/, // Just punctuation
      /^(huh|um+|uh+|hmm+|ah+|oh+|eh+|meh)$/i, // Confused sounds
    ],
    confidence: 0.90,
    requiresContext: false,
  },

  // Commands
  {
    intent: 'task_request',
    patterns: [
      /^(write|create|build|generate|make)\s+(me\s+)?(a|an|some|the)\s+/i,
      /^(help|assist)\s+(me\s+)?(with|to)\s+/i,
      /^can\s+you\s+(write|create|build|generate|make|help)/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'reminder_request',
    patterns: [
      /^remind\s+me\s+(to|about|in|at)/i,
      /^set\s+(a\s+)?(reminder|alarm)/i,
      /^(wake|alert)\s+me\s+(up\s+)?(at|in)/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'correction',
    patterns: [
      /^(no|wait),?\s*(i\s+meant|actually|i\s+said)/i,
      /^(actually|wait),?\s+/i,
      /^(fix|change|correct)\s+(that|this|it)/i,
    ],
    confidence: 0.85,
    requiresContext: true,
  },
  {
    intent: 'calculation',
    patterns: [
      /^(calculate|compute|what\s*is)\s*[\d\s+\-*/().]+$/i,
      /^\d+\s*[+\-*/]\s*\d+/,
    ],
    confidence: 0.95,
  },
  {
    intent: 'translation',
    patterns: [
      /^translate\s+.+\s+(to|into)\s+\w+/i,
      /^how\s*do\s*you\s*say\s+.+\s+in\s+\w+/i,
      // Match "what's X in [language]" - require common language names to avoid false positives
      /^what'?s?\s+.+\s+in\s+(english|spanish|french|german|italian|portuguese|chinese|japanese|korean|arabic|russian|hindi|dutch|swedish|norwegian|danish|finnish|polish|czech|greek|turkish|hebrew|thai|vietnamese|indonesian|latin)\b/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'summarization',
    patterns: [
      /^(summarize|sum\s*up|tldr|tl;?dr|give\s*me\s*(a\s*)?summary)/i,
    ],
    confidence: 0.90,
  },

  // Joke requests
  {
    intent: 'joke_request',
    patterns: [
      /^tell\s*me\s*(a\s+)?joke/i,
      /^make\s*me\s*laugh/i,
      /^cheer\s*me\s*up/i,
      /^got\s*any\s*jokes/i,
      /^give\s*me\s*(a\s+)?joke/i,
      /^i\s*(need|want)\s*(a\s+)?(good\s+)?joke/i,
      /^something\s*funny/i,
      /^crack\s*(me\s+)?(a\s+)?joke/i,
      /^joke\s*(please|pls|\?)*/i,
      // German patterns
      /^erzähl\s*(mir\s+)?(einen\s+)?witz/i,
      /^mach\s*(mal\s+)?(einen\s+)?witz/i,
      /^bringe\s*mich\s*zum\s*lachen/i,
    ],
    confidence: 0.95,
  },

  // Plan workflow intents
  {
    intent: 'plan_propose',
    patterns: [
      /^(create|make|write|draft|propose)\s+(a\s+)?plan\s+(to|for|about)/i,
      /^plan\s+(how\s+to|out|for)\s+/i,
      /^(let's|help\s*me)\s+plan\s+/i,
      /^(i\s+want\s+to|i\s+need\s+to)\s+plan\s+/i,
      /^can\s+you\s+(create|make|draft|propose)\s+(a\s+)?plan/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'plan_feedback',
    patterns: [
      /^(change|modify|update|adjust|revise)\s+(the\s+)?plan/i,
      /^(add|remove|include|exclude)\s+.+\s+(to|from|in)\s+(the\s+)?plan/i,
      /^(in\s+)?the\s+plan,?\s+(change|add|remove|modify)/i,
      /^instead\s+of\s+.+,?\s+(use|do|try)/i,
      /^(what\s+if|how\s+about|consider)\s+/i,
    ],
    confidence: 0.85,
    requiresContext: true,
  },
  {
    intent: 'plan_approve',
    patterns: [
      /^(looks?\s+good|lgtm|approve|approved)[\s!?.]*$/i,
      /^(go\s+ahead|proceed|ship\s+it)[\s!?.]*$/i,
      /^(yes|yeah|yep),?\s*(approve|proceed|go\s+ahead)/i,
      /^(that'?s?\s*)?(perfect|great|good),?\s*(approve|proceed)?/i,
      /^(i\s+)?(approve|accept)\s+(this\s+)?(plan)?/i,
    ],
    confidence: 0.85,
    requiresContext: true,
  },
  {
    intent: 'plan_execute',
    patterns: [
      /^(execute|run|start|begin|launch)[\s!?.]*$/i,
      /^(execute|run|start)\s+(the\s+)?(plan|loop|it)/i,
      /^(let's\s+)?(do\s+it|go|run\s+it)[\s!?.]*$/i,
      /^start\s+(the\s+)?execution/i,
      /^(kick\s+)?off[\s!?.]*$/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'plan_status',
    patterns: [
      /^(what'?s?\s*(the\s+)?)?status[\s!?.]*$/i,
      /^(how'?s?\s+(the\s+)?plan(\s+going)?)/i,
      /^(show\s+me\s+)?(the\s+)?progress/i,
      /^(where\s+are\s+we|what'?s?\s+happening)/i,
      /^status\s+(update|check|report)/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'plan_cancel',
    patterns: [
      /^(cancel|stop|abort|kill)\s+(the\s+)?(plan|execution)/i,
      /^(nevermind|forget\s+it|stop)[\s!?.]*$/i,
      /^(cancel|abort)[\s!?.]*$/i,
      /^(don't|do\s+not)\s+(run|execute|proceed)/i,
    ],
    confidence: 0.90,
  },
  {
    intent: 'plan_list',
    patterns: [
      /^(list|show|display)\s+(all\s+)?(my\s+)?plans/i,
      /^(what\s+)?(plans?\s+)?do\s+i\s+have/i,
      /^my\s+plans[\s!?.]*$/i,
      /^(show|get)\s+plans/i,
    ],
    confidence: 0.90,
  },

  // Therapeutic intents for 2-person group chats
  {
    intent: 'emotional_expression',
    patterns: [
      /^i\s+(feel|am|felt|was)\s+(so\s+)?(sad|happy|angry|frustrated|anxious|worried|excited|scared|hurt|upset)/i,
      /^i'?m\s+(so\s+)?(sad|happy|angry|frustrated|anxious|worried|excited|scared|hurt|upset)/i,
      /(makes|made)\s+me\s+(feel\s+)?(sad|happy|angry|frustrated|anxious|worried|scared|hurt)/i,
      /^i'?ve\s+been\s+(feeling|struggling|dealing)\s+with/i,
      /it'?s?\s+(been\s+)?(hard|difficult|tough|overwhelming)\s+(for\s+me)?/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'seeking_validation',
    patterns: [
      /^(am\s+i\s+)?(wrong|crazy|overreacting|being\s+unreasonable)/i,
      /^(does|do)\s+(that\s+)?(make\s+sense|sound\s+right)/i,
      /^(is\s+it\s+)?(wrong|right|okay|normal)\s+(to|that)/i,
      /^i\s+(don'?t\s+)?know\s+(what\s+to\s+)?(think|do|feel)/i,
      /^(can\s+you\s+)?(understand|see)\s+(why|how)/i,
      /^(does|do)\s+anyone\s+(else\s+)?(feel|think|agree)/i,
    ],
    confidence: 0.80,
  },
  {
    intent: 'relationship_discussion',
    patterns: [
      /\b(our|we|us)\s+(relationship|marriage|partnership|friendship)\b/i,
      /^we\s+(need|should|have)\s+to\s+(talk|discuss|work)/i,
      /\b(between\s+us|our\s+issues|our\s+problems)\b/i,
      /^i\s+(don'?t\s+)?(know\s+)?(if|whether)\s+(we|i)\s+(can|should)/i,
      /we\s+(['\u2019]?ve\s+)?(been\s+)?(having\s+)?(problems|issues|trouble)/i,
      /^(my|our)\s+(partner|spouse|husband|wife|boyfriend|girlfriend)\s+(and\s+i|is)/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'celebration_moment',
    patterns: [
      /^(we|i)\s+(did\s+it|made\s+it|got\s+it)/i,
      /^(so\s+)?(happy|excited|proud)\s+(for\s+)?(us|you|both)/i,
      /^(this\s+is\s+)?(such\s+a\s+)?(great|wonderful|amazing)\s+(moment|news)/i,
      /^(we\s+)?(finally|just)\s+(did|achieved|accomplished|reached)/i,
      /^(best\s+)?(news|thing)\s+(ever|today)/i,
      /^(wow|omg|amazing|awesome)[\s!?.]+/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'support_request',
    patterns: [
      /^(can|could)\s+(you|we)\s+(help|support|assist)/i,
      /^i\s+(need|want)\s+(some\s+)?(help|support|advice)/i,
      /^(please\s+)?(help|listen)\s+(me|us)/i,
      /^(i\s+don'?t\s+)?know\s+(what\s+to\s+)?do/i,
      /^(any\s+)?(advice|suggestions|thoughts)/i,
      /^how\s+(do|should|can)\s+(i|we)\s+(handle|deal|cope)/i,
    ],
    confidence: 0.85,
  },
  {
    intent: 'conflict_moment',
    patterns: [
      /^(you\s+)?(always|never)\s+/i,
      /^that'?s?\s+(not\s+)?(true|fair|right)/i,
      /^i\s+(didn'?t\s+)?(say|mean|do)\s+that/i,
      /^(why\s+do\s+)?you\s+(always|never|keep)/i,
      /^you'?re\s+(not\s+)?(listening|understanding|getting\s+it)/i,
      /^stop\s+(saying|doing|acting)/i,
      /^(that'?s?\s+)?(ridiculous|absurd|unfair)/i,
      /^i\s+(can'?t\s+)?(believe|understand)\s+you/i,
    ],
    confidence: 0.80,
  },
];

// ============================================================================
// Context Reference Patterns (for multi-turn detection)
// ============================================================================

export const CONTEXT_REFERENCE_PATTERNS = {
  pronouns: /\b(it|this|that|these|those|they|them|he|she|its|their)\b/i,
  explicit: /\b(earlier|before|previous|last|mentioned|said|above|you\s*said)\b/i,
  continuation: /^(also|and|another|plus|additionally|furthermore|moreover)\b/i,
  followUp: /^(so|then|but|however|well|anyway|btw|by\s*the\s*way)\b/i,
};
