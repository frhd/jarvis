/**
 * Capability Manifest System
 *
 * Centralized system for managing and communicating Jarvis's capabilities.
 * Provides a single source of truth for what Jarvis can do.
 *
 * This system ensures:
 * 1. Consistent capability communication across all LLM interactions
 * 2. Easy addition of new capabilities
 * 3. Capability toggling via feature flags
 */

import { featureFlags } from './feature-flags.js';

/**
 * Capability categories for organization
 */
export enum CapabilityCategory {
  MESSAGING = 'messaging',
  FILE_OPS = 'file_operations',
  SYSTEM = 'system_ops',
  AI = 'ai_features',
  MEMORY = 'memory_system',
  SECURITY = 'security',
}

/**
 * Individual capability definition
 */
export interface Capability {
  id: string;
  name: string;
  description: string;
  category: CapabilityCategory;
  enabled: () => boolean;
  examples: string[];
  limitations?: string[];
}

/**
 * Capability manifest - all capabilities Jarvis has
 */
export const CAPABILITIES: Capability[] = [
  // Messaging capabilities
  {
    id: 'telegram_send_message',
    name: 'Send Telegram Messages',
    description: 'You CANNOT send messages to phone numbers. You can only respond to messages in the current chat. You DO NOT have the ability to initiate new conversations or send messages to arbitrary users.',
    category: CapabilityCategory.MESSAGING,
    enabled: () => true, // Always enabled for Jarvis
    examples: [
      'Respond to the current conversation',
      'Reply to user questions',
      'Provide information based on the context',
    ],
    limitations: [
      'You CANNOT send SMS messages (text messages to phone numbers)',
      'You CANNOT send Telegram messages to arbitrary phone numbers',
      'You CANNOT send Telegram messages to users who have not messaged the bot first',
      'You can only send Telegram messages as replies in the current chat',
      'You DO NOT have the ability to initiate new conversations',
    ],
  },
  {
    id: 'telegram_read_messages',
    name: 'Read Telegram Messages',
    description: 'You CAN read and process incoming Telegram messages.',
    category: CapabilityCategory.MESSAGING,
    enabled: () => true,
    examples: [
      'Read my recent messages',
      'Check for new messages',
    ],
  },

  // File operations
  {
    id: 'file_read',
    name: 'Read Files',
    description: 'You CAN read files from the local system.',
    category: CapabilityCategory.FILE_OPS,
    enabled: () => true,
    examples: [
      'Read the config file',
      'Show me package.json',
      'Check the logs',
    ],
  },
  {
    id: 'file_write',
    name: 'Write Files',
    description: 'You CAN write and create files on the local system.',
    category: CapabilityCategory.FILE_OPS,
    enabled: () => true,
    examples: [
      'Create a new file',
      'Save this to a file',
      'Write the configuration',
    ],
  },
  {
    id: 'file_edit',
    name: 'Edit Files',
    description: 'You CAN edit existing files on the local system.',
    category: CapabilityCategory.FILE_OPS,
    enabled: () => true,
    examples: [
      'Update the config',
      'Fix the bug in this file',
      'Modify the code',
    ],
  },

  // System operations
  {
    id: 'shell_execute',
    name: 'Execute Shell Commands',
    description: 'You CAN execute shell commands on the local system.',
    category: CapabilityCategory.SYSTEM,
    enabled: () => true,
    examples: [
      'Run the tests',
      'Build the project',
      'Check the process status',
      'Restart the service',
    ],
    limitations: [
      'This capability is restricted to system owner only',
    ],
  },
  {
    id: 'shell_bash',
    name: 'Bash Shell Access',
    description: 'You CAN run bash scripts and interact with the shell.',
    category: CapabilityCategory.SYSTEM,
    enabled: () => true,
    examples: [
      'Run this bash script',
      'Execute a command in bash',
    ],
    limitations: [
      'This capability is restricted to system owner only',
    ],
  },

  // AI features
  {
    id: 'web_search',
    name: 'Web Search',
    description: 'You CAN search the web for current information.',
    category: CapabilityCategory.AI,
    enabled: () => featureFlags.isEnabled('webSearch.enabled'),
    examples: [
      'Search for current weather',
      'Look up recent news',
      'Find information about X',
    ],
  },
  {
    id: 'agentic_tasks',
    name: 'Agentic Tasks',
    description: 'You CAN use tools to perform multi-step tasks including file operations and shell commands.',
    category: CapabilityCategory.AI,
    enabled: () => featureFlags.isEnabled('tools.enabled'),
    examples: [
      'Create a new feature file',
      'Implement the fix',
      'Set up the project',
    ],
    limitations: [
      'This capability is restricted to system owner only',
    ],
  },
  {
    id: 'voice_transcription',
    name: 'Voice Transcription',
    description: 'You CAN transcribe voice messages to text.',
    category: CapabilityCategory.AI,
    enabled: () => featureFlags.isEnabled('transcription.enabled'),
    examples: [
      'Transcribe voice messages',
      'Read what I said',
    ],
  },
  {
    id: 'contact_management',
    name: 'Contact Management',
    description: 'You CAN manage contacts including saving, finding, and updating contact information.',
    category: CapabilityCategory.AI,
    enabled: () => true,
    examples: [
      'Save Lenn as a contact',
      'Find Sarah in my contacts',
      'Update Lenn\'s phone number',
    ],
  },

  // Memory system
  {
    id: 'semantic_memory',
    name: 'Semantic Memory',
    description: 'You CAN store and retrieve information from long-term memory using semantic search.',
    category: CapabilityCategory.MEMORY,
    enabled: () => featureFlags.isEnabled('memory.enabled'),
    examples: [
      'Remember that I prefer tea',
      'Recall what we discussed yesterday',
      'Store this information',
    ],
  },
  {
    id: 'user_preferences',
    name: 'User Preferences',
    description: 'You CAN remember and respect user preferences like language, style, and behavior.',
    category: CapabilityCategory.MEMORY,
    enabled: () => true,
    examples: [
      'I prefer English',
      'Talk in the style of Louis CK',
      'Use metric units',
    ],
  },

  // Security
  {
    id: 'owner_only_operations',
    name: 'Owner-Only Operations',
    description: 'Some operations like file access and shell commands are restricted to the system owner.',
    category: CapabilityCategory.SECURITY,
    enabled: () => true,
    examples: [],
    limitations: [
      'Only the system owner can access sensitive operations',
      'Non-owner users receive helpful refusals for restricted operations',
    ],
  },
];

/**
 * CapabilityManifest class - manages capabilities and provides formatted output
 */
export class CapabilityManifest {
  private capabilities: Map<string, Capability>;

  constructor() {
    this.capabilities = new Map();
    for (const cap of CAPABILITIES) {
      this.capabilities.set(cap.id, cap);
    }
  }

  /**
   * Get a capability by ID
   */
  getCapability(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  /**
   * Get all enabled capabilities
   */
  getEnabledCapabilities(): Capability[] {
    return CAPABILITIES.filter(cap => cap.enabled());
  }

  /**
   * Get capabilities by category
   */
  getCapabilitiesByCategory(category: CapabilityCategory): Capability[] {
    return CAPABILITIES.filter(
      cap => cap.category === category && cap.enabled()
    );
  }

  /**
   * Generate system prompt injection with all capabilities
   * This should be included in every LLM request
   */
  generateCapabilityPrompt(): string {
    const enabledCaps = this.getEnabledCapabilities();
    if (enabledCaps.length === 0) {
      return '';
    }

    // Group by category
    const grouped = new Map<CapabilityCategory, Capability[]>();
    for (const cap of enabledCaps) {
      if (!grouped.has(cap.category)) {
        grouped.set(cap.category, []);
      }
      grouped.get(cap.category)!.push(cap);
    }

    // Build prompt
    let prompt = `IMPORTANT CAPABILITIES (REMEMBER THESE):\n\n`;

    // Messaging section (most important)
    const messagingCaps = grouped.get(CapabilityCategory.MESSAGING);
    if (messagingCaps && messagingCaps.length > 0) {
      prompt += 'MESSAGING:\n';
      for (const cap of messagingCaps) {
        prompt += `- ${cap.description}\n`;
        if (cap.limitations) {
          for (const lim of cap.limitations) {
            prompt += `  ${lim}\n`;
          }
        }
      }
      prompt += '\n';
    }

    // File operations
    const fileOpsCaps = grouped.get(CapabilityCategory.FILE_OPS);
    if (fileOpsCaps && fileOpsCaps.length > 0) {
      prompt += 'FILE OPERATIONS:\n';
      for (const cap of fileOpsCaps) {
        prompt += `- ${cap.description}\n`;
      }
      prompt += '\n';
    }

    // System operations
    const systemCaps = grouped.get(CapabilityCategory.SYSTEM);
    if (systemCaps && systemCaps.length > 0) {
      prompt += 'SYSTEM OPERATIONS:\n';
      for (const cap of systemCaps) {
        prompt += `- ${cap.description}\n`;
        if (cap.limitations) {
          for (const lim of cap.limitations) {
            prompt += `  ${lim}\n`;
          }
        }
      }
      prompt += '\n';
    }

    // AI features
    const aiCaps = grouped.get(CapabilityCategory.AI);
    if (aiCaps && aiCaps.length > 0) {
      prompt += 'AI FEATURES:\n';
      for (const cap of aiCaps) {
        prompt += `- ${cap.description}\n`;
        if (cap.limitations) {
          for (const lim of cap.limitations) {
            prompt += `  ${lim}\n`;
          }
        }
      }
      prompt += '\n';
    }

    // Memory
    const memoryCaps = grouped.get(CapabilityCategory.MEMORY);
    if (memoryCaps && memoryCaps.length > 0) {
      prompt += 'MEMORY & PREFERENCES:\n';
      for (const cap of memoryCaps) {
        prompt += `- ${cap.description}\n`;
      }
      prompt += '\n';
    }

    // Important reminder
    prompt += `CRITICAL RULES:\n`;
    prompt += `- When users correct you about capabilities (e.g., "you CAN send messages", "you know you can do X"), acknowledge and remember this.\n`;
    prompt += `- Never forget these capabilities - they are your core functions.\n`;
    prompt += `- If unsure about whether you can do something, check this list first.\n`;
    prompt += `- You DO NOT have capabilities that are not listed here.\n`;

    return prompt;
  }

  /**
   * Generate short capability summary for contexts
   */
  generateShortSummary(): string {
    const enabledCaps = this.getEnabledCapabilities();
    const descriptions = enabledCaps.map(cap => cap.description);
    return `Capabilities: ${descriptions.join('; ')}`;
  }

  /**
   * Check if a capability is enabled
   */
  isCapabilityEnabled(id: string): boolean {
    const cap = this.getCapability(id);
    return cap ? cap.enabled() : false;
  }

  /**
   * Get all capabilities as a snapshot
   */
  getSnapshot(): Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    enabled: boolean;
  }> {
    return CAPABILITIES.map(cap => ({
      id: cap.id,
      name: cap.name,
      description: cap.description,
      category: cap.category,
      enabled: cap.enabled(),
    }));
  }
}

// Export singleton instance
export const capabilityManifest = new CapabilityManifest();
