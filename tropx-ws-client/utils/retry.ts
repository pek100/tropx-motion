import { RETRY } from './constants';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

// Execute function with exponential backoff retry
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RETRY.MAX_ATTEMPTS;
  const baseDelay = options.baseDelay ?? RETRY.BASE_DELAY;
  const maxDelay = options.maxDelay ?? RETRY.MAX_DELAY;
  const multiplier = options.backoffMultiplier ?? RETRY.BACKOFF_MULTIPLIER;
  let lastError: Error;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay);
        await sleep(delay);
      }
    }
  }
  throw lastError!;
}

// Calculate exponential backoff delay
export function calculateBackoff(attempt: number, baseDelay = RETRY.BASE_DELAY, maxDelay = RETRY.MAX_DELAY): number {
  return Math.min(baseDelay * Math.pow(RETRY.BACKOFF_MULTIPLIER, attempt), maxDelay);
}

// Sleep utility
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
