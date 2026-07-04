/**
 * Slack Platform Configuration
 * Generic Slack configuration without module-specific settings.
 */

export interface SlackConfig {
  enabled: boolean;
  botToken: string;
  appToken: string;
  channelId: string;
  testUserId: string;
}
