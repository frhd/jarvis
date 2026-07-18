import type { Message, Sender, Chat } from '../../types/index.js';
import { ChatMessage } from '../../clients/llm.client.js';
import { getRecentMessages } from '../../utils/index.js';
import { capabilityManifest } from '../../config/capabilities.js';
import { languagePreferenceService } from '../languagePreference.service.js';
import {
  CONVERSATION_HISTORY_LIMIT,
  LANGUAGE_DETECTION_MESSAGE_COUNT,
  NON_OWNER_SAFETY_INSTRUCTION,
} from './llm-router.constants.js';

/**
 * Prepend safety context for non-owner users and add language preference
 *
 * @param context - Original RAG context
 * @param isOwner - Whether the user is the system owner
 * @param chat - Optional chat for language preference
 * @returns Modified context string
 */
export function prependSafetyContext(context: string, isOwner?: boolean, chat?: Chat): string {
  let modifiedContext = context;

  // Prepend safety instruction for non-owner users
  if (isOwner === false) {
    modifiedContext = NON_OWNER_SAFETY_INSTRUCTION + modifiedContext;
  }

  // Add language preference to context if available
  if (chat?.preferredLanguage) {
    const languageContext = languagePreferenceService.getLanguageContext(chat.preferredLanguage);
    modifiedContext = `${languageContext}\n\n${modifiedContext}`;
  }

  return modifiedContext;
}

/**
 * Build context for agentic tasks including user info and recent conversation
 *
 * @param sender - The sender of the message (for context)
 * @param conversationHistory - Recent conversation history for context
 * @returns Context string with user info and recent messages
 */
export function buildAgenticContext(
  sender: Sender | null,
  conversationHistory: Message[]
): string {
  let context = '';

  // Add user information
  if (sender) {
    context += `User: ${sender.firstName || 'User'}`;
    if (sender.username) context += ` (@${sender.username})`;
    context += '\n';
  }

  // Add recent conversation for context (messages are in descending order)
  const recentMessages = getRecentMessages(conversationHistory, LANGUAGE_DETECTION_MESSAGE_COUNT);
  if (recentMessages.length > 0) {
    context += '\nRecent conversation:\n';
    for (const msg of recentMessages) {
      const role = msg.senderId === sender?.id ? 'User' : 'Jarvis';
      context += `${role}: ${msg.text?.substring(0, 200) || '[no text]'}\n`;
    }
  }

  return context;
}

/**
 * Construct the full agentic task prompt with capabilities and instructions
 *
 * @param context - Context string with user info and memories
 * @param messageText - The current request text
 * @returns Complete task prompt for the agentic LLM
 */
export function constructAgenticPrompt(context: string, messageText: string): string {
  const capabilityPrompt = capabilityManifest.generateCapabilityPrompt();

  return `${context}\n\nCurrent request: ${messageText}\n\nYou are Jarvis, a helpful personal assistant running as a Telegram bot. You are responding to the user via Telegram.

${capabilityPrompt}

- Keep responses short and casual. You're a chill friend, not a corporate assistant.
- The user is in Germany. Use metric units (Celsius, kilometers, etc.).

STORING MEMORIES:
- To store a new memory, use: sqlite3 data/jarvis.db "INSERT INTO memories (id, senderId, memoryType, content, confidence, isArchived, accessCount, sourceMessageIds, createdAt, updatedAt, lastAccessedAt) VALUES ('<nanoid>', '<senderId>', '<type>', '<content>', <confidence>, 0, 0, '[]', unixepoch(), unixepoch(), unixepoch());"
- IMPORTANT: After inserting a memory, you MUST also create an embedding for RAG to work:
  1. First get the embedding from Ollama: curl -s http://localhost:11434/api/embeddings -d '{"model": "nomic-embed-text", "prompt": "<content>"}' | jq -r '.embedding'
  2. Then insert it: sqlite3 data/jarvis.db "INSERT INTO embeddings (id, sourceType, sourceId, content, embedding, model, dimensions, createdAt) VALUES ('<nanoid>', 'memory', '<memory_id>', '<content>', '<embedding_json>', 'nomic-embed-text', 768, unixepoch());"
- Memory types: fact, preference, event, relationship`;
}

/**
 * Build conversation messages for Ollama chat API
 *
 * @param history - Conversation history
 * @param currentMessage - Current message to respond to
 * @returns Array of chat messages
 */
export function buildConversationMessages(
  history: Message[],
  currentMessage: Message
): ChatMessage[] {
  // Use capability manifest for system prompt
  const capabilityPrompt = capabilityManifest.generateCapabilityPrompt();

  const systemPrompt = `You're Jarvis, a friendly and chill assistant. Keep responses under 3500 characters.

${capabilityPrompt}

You have full access to the local machine - you can read/write files, execute shell commands, browse the filesystem, and interact with system services.`;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
  ];

  // Add conversation history (last N messages, in chronological order)
  const recent = history.slice(0, CONVERSATION_HISTORY_LIMIT).reverse();

  for (const msg of recent) {
    if (!msg.text) continue;
    messages.push({
      role: msg.isBot ? 'assistant' : 'user',
      content: msg.text,
    });
  }

  // Add current message
  if (currentMessage.text) {
    messages.push({
      role: 'user',
      content: currentMessage.text,
    });
  }

  return messages;
}
