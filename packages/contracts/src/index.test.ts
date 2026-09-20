import { describe, expect, test } from 'vitest';
import { API_VERSION } from './index.js';

describe('API_VERSION', () => {
  test('AR-08: routes live under a version, so a breaking change can get a new one', () => {
    expect(API_VERSION).toBe('v1');
  });
});
