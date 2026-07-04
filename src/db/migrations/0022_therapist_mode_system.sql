-- Migration: Therapist/Listener Mode System
-- Creates tables for dyad detection, emotional tracking, and intervention logic

-- Add participant_count column to conversations table for dyad detection
ALTER TABLE conversations ADD COLUMN participant_count INTEGER DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conversations_participant_count ON conversations(participant_count);
--> statement-breakpoint

-- Therapist Mode Config table - Per-conversation settings and consent
CREATE TABLE IF NOT EXISTS therapistModeConfig (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode_type TEXT NOT NULL DEFAULT 'active_listener',
  consented_by_user_ids TEXT NOT NULL DEFAULT '[]',
  response_frequency TEXT NOT NULL DEFAULT 'minimal',
  last_intervention_at INTEGER,
  interventions_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_therapist_config_conversation ON therapistModeConfig(conversation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_therapist_config_enabled ON therapistModeConfig(enabled);
--> statement-breakpoint

-- Dyad Emotional States table - Track emotional patterns per user in dyads
CREATE TABLE IF NOT EXISTS dyadEmotionalStates (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  primary_emotion TEXT NOT NULL,
  emotion_intensity INTEGER NOT NULL DEFAULT 50,
  emotion_trend TEXT NOT NULL DEFAULT 'stable',
  last_analyzed_at INTEGER NOT NULL,
  analysis_data TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_dyad_emotional_conversation ON dyadEmotionalStates(conversation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dyad_emotional_user ON dyadEmotionalStates(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dyad_emotional_conversation_user ON dyadEmotionalStates(conversation_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dyad_emotional_analyzed_at ON dyadEmotionalStates(last_analyzed_at);
--> statement-breakpoint

-- Conversation Dynamics table - Communication pattern analysis
CREATE TABLE IF NOT EXISTS conversationDynamics (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tension_level INTEGER NOT NULL DEFAULT 0,
  conflict_detected INTEGER NOT NULL DEFAULT 0,
  conflict_type TEXT,
  positive_moments_count INTEGER NOT NULL DEFAULT 0,
  turn_taking_balance REAL NOT NULL DEFAULT 0.5,
  topic_coherence REAL NOT NULL DEFAULT 0.5,
  support_patterns TEXT DEFAULT '[]',
  last_analyzed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_conversation_dynamics_conversation ON conversationDynamics(conversation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conversation_dynamics_tension ON conversationDynamics(tension_level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conversation_dynamics_conflict ON conversationDynamics(conflict_detected);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conversation_dynamics_analyzed_at ON conversationDynamics(last_analyzed_at);
