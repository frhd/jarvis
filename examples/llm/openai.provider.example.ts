/**
 * OpenAI Provider Usage Example
 *
 * This file demonstrates how to use the OpenAI provider
 */

import { OpenAIProvider } from '../../src/llm/providers/openai.provider.js';
import { UnifiedChatRequest } from '../../src/types/llm.types.js';

async function example() {
  // Initialize provider
  const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY || 'sk-...',
    organization: process.env.OPENAI_ORG_ID, // Optional
    baseUrl: 'https://api.openai.com/v1', // Optional, defaults to this
    enabled: true,
    defaultModel: 'gpt-4o-mini',
    models: [], // Uses default models if empty
    timeoutMs: 60000,
    maxRetries: 3,
  });

  await provider.initialize();

  // Example 1: Simple chat
  console.log('\n=== Example 1: Simple Chat ===');
  const simpleRequest: UnifiedChatRequest = {
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the capital of France?' },
    ],
    temperature: 0.7,
    maxTokens: 100,
  };

  const response = await provider.chat(simpleRequest);
  console.log('Response:', response.content);
  console.log('Usage:', response.usage);
  console.log('Metadata:', response.metadata);

  // Example 2: Streaming chat
  console.log('\n=== Example 2: Streaming Chat ===');
  const streamRequest: UnifiedChatRequest = {
    messages: [
      { role: 'user', content: 'Write a short poem about TypeScript.' },
    ],
    temperature: 0.9,
  };

  console.log('Streaming response:');
  for await (const chunk of provider.stream(streamRequest)) {
    if (chunk.content) {
      process.stdout.write(chunk.content);
    }
    if (chunk.done) {
      console.log('\n\nDone!');
      console.log('Usage:', chunk.usage);
    }
  }

  // Example 3: Tool calling
  console.log('\n=== Example 3: Tool Calling ===');
  const toolRequest: UnifiedChatRequest = {
    messages: [
      {
        role: 'user',
        content: 'What is the weather in San Francisco?',
      },
    ],
    tools: [
      {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'The temperature unit',
            },
          },
          required: ['location'],
        },
      },
    ],
    toolChoice: 'auto',
  };

  const toolResponse = await provider.chat(toolRequest);
  console.log('Tool calls:', toolResponse.toolCalls);
  console.log('Content:', toolResponse.content);

  // Example 4: Vision (GPT-4V)
  console.log('\n=== Example 4: Vision ===');
  const visionRequest: UnifiedChatRequest = {
    model: 'gpt-4o', // Vision-capable model
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is in this image?',
          },
          {
            type: 'image_url',
            image_url: {
              url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg',
              detail: 'high',
            },
          },
        ],
      },
    ],
  };

  const visionResponse = await provider.chat(visionRequest);
  console.log('Vision response:', visionResponse.content);

  // Example 5: JSON mode
  console.log('\n=== Example 5: JSON Mode ===');
  const jsonRequest: UnifiedChatRequest = {
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that outputs JSON.',
      },
      {
        role: 'user',
        content: 'List 3 colors with their hex codes.',
      },
    ],
    jsonMode: true,
  };

  const jsonResponse = await provider.chat(jsonRequest);
  console.log('JSON response:', jsonResponse.content);
  const parsed = JSON.parse(jsonResponse.content);
  console.log('Parsed:', parsed);

  // Example 6: Health check
  console.log('\n=== Example 6: Health Check ===');
  const health = await provider.healthCheck();
  console.log('Health:', health);

  // Example 7: List models
  console.log('\n=== Example 7: List Models ===');
  const models = await provider.listModels();
  console.log('Available models:', models.map((m) => m.id));

  // Example 8: Get capabilities
  console.log('\n=== Example 8: Get Capabilities ===');
  const capabilities = provider.getCapabilities();
  console.log('Provider capabilities:', capabilities);

  // Example 9: Estimate cost
  console.log('\n=== Example 9: Estimate Cost ===');
  const costEstimate = provider.estimateCost(simpleRequest);
  console.log('Cost estimate:', costEstimate);
  console.log(`Estimated total: $${costEstimate.totalCost.toFixed(6)}`);

  // Example 10: Using different models
  console.log('\n=== Example 10: Different Models ===');

  // Fast and cheap: gpt-4o-mini
  const miniResponse = await provider.chat({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hi!' }],
  });
  console.log('Mini model:', miniResponse.metadata.model);

  // Reasoning: o1-mini
  const o1Response = await provider.chat({
    model: 'o1-mini',
    messages: [
      { role: 'user', content: 'Solve: If x + 2 = 5, what is x?' },
    ],
  });
  console.log('O1 model reasoning:', o1Response.content);

  // Shutdown
  await provider.shutdown();
  console.log('\n=== Provider shut down ===');
}

// Run example if executed directly
if (require.main === module) {
  example().catch(console.error);
}
