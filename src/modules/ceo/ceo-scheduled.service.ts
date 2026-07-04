/**
 * CEO Scheduled Service
 * Manages scheduled message rotation with persistence.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger.js';
import { WEEKEND_MESSAGES, MESSAGES, getTimeOfDay, isWeekend } from './ceo-messages.js';

const logger = createLogger('CeoScheduled');

interface PoolState {
  order: number[];
  index: number;
}

interface MessageState {
  weekend: PoolState;
  morning: PoolState;
  afternoon: PoolState;
  evening: PoolState;
}

const STATE_FILE = path.join(process.cwd(), '.message-state.json');

function shuffle(size: number): number[] {
  const arr = Array.from({ length: size }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadState(): MessageState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {
      weekend: { order: [], index: 0 },
      morning: { order: [], index: 0 },
      afternoon: { order: [], index: 0 },
      evening: { order: [], index: 0 },
    };
  }
}

function saveState(state: MessageState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getNextIndex(
  pool: keyof MessageState,
  poolSize: number,
  state: MessageState,
): number {
  const poolState = state[pool];

  if (poolState.order.length === 0 || poolState.index >= poolState.order.length) {
    poolState.order = shuffle(poolSize);
    poolState.index = 0;
  }

  const messageIndex = poolState.order[poolState.index];
  poolState.index++;
  return messageIndex;
}

export class CeoScheduledService {
  pickMessage(): string {
    const state = loadState();

    let message: string;
    if (isWeekend()) {
      const index = getNextIndex('weekend', WEEKEND_MESSAGES.length, state);
      message = WEEKEND_MESSAGES[index];
    } else {
      const timeOfDay = getTimeOfDay();
      const messages = MESSAGES[timeOfDay];
      const index = getNextIndex(timeOfDay, messages.length, state);
      message = messages[index];
    }

    saveState(state);
    logger.info('Picked scheduled message', { length: message.length, weekend: isWeekend(), timeOfDay: getTimeOfDay() });
    return message;
  }
}
