import { jest } from '@jest/globals';
import { z } from 'zod';

const originalFetch = global.fetch;

describe('ai provider request payload', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.OPENAI_MODEL = 'gpt-5.6-luna';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    process.env.OPENAI_TIMEOUT_MS = '30000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('omits temperature from the upstream OpenAI request payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }),
    });
    global.fetch = fetchMock;

    const { requestStructuredCompletion } = await import('../src/services/aiProvider.service.js');
    const schema = { safeParse: (value) => ({ success: true, data: value }) };

    await requestStructuredCompletion({
      system: 'Return valid JSON.',
      user: 'Test payload',
      schema,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body);

    expect(payload).toHaveProperty('response_format');
    expect(payload).not.toHaveProperty('temperature');
    expect(payload.model).toBe('gpt-5.6-luna');
  });

  test('returns AI_INVALID_RESPONSE for schema validation failures without exposing raw AI content', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          finish_reason: 'content_filter',
          message: { content: JSON.stringify({ suggestions: [{ section: 'summary', suggestion: 'too long', reason: 'reason' }, { unknown: true }] }) },
        }],
      }),
    });
    global.fetch = fetchMock;

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { requestStructuredCompletion } = await import('../src/services/aiProvider.service.js');
    const schema = z.object({
      suggestions: z.array(z.object({
        section: z.string().max(80),
        suggestion: z.string().max(3000),
        reason: z.string().max(1000),
      }).strict()).max(10),
    }).strict();

    await expect(requestStructuredCompletion({
      system: 'Return valid JSON.',
      user: 'Test invalid schema',
      schema,
    })).rejects.toMatchObject({
      publicCode: 'AI_INVALID_RESPONSE',
      status: 502,
      message: 'AI assistance returned an invalid result.',
    });

    expect(consoleSpy).toHaveBeenCalledWith('AI_STRUCTURED_RESPONSE_VALIDATION_FAILED', expect.objectContaining({
      issues: expect.any(Array),
      parsedType: 'object',
      topLevelKeys: expect.arrayContaining(['suggestions']),
      suggestionsCount: 2,
      finishReason: 'content_filter',
    }));

    const logged = consoleSpy.mock.calls.flat();
    expect(logged.join(' ')).not.toContain('too long');
    expect(logged.join(' ')).not.toContain('AI assistance returned an invalid result.');
    expect(logged.join(' ')).not.toContain('content_filter');
    expect(logged.join(' ')).not.toContain('suggestions');
  });

  test('preserves successful structured response handling', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          finish_reason: 'stop',
          message: { content: JSON.stringify({ suggestions: [{ section: 'summary', suggestion: 'Short suggestion', reason: 'Clearer wording' }] }) },
        }],
      }),
    });
    global.fetch = fetchMock;

    const { requestStructuredCompletion } = await import('../src/services/aiProvider.service.js');
    const schema = z.object({
      suggestions: z.array(z.object({
        section: z.string().max(80),
        suggestion: z.string().max(3000),
        reason: z.string().max(1000),
      }).strict()).max(10),
    }).strict();

    await expect(requestStructuredCompletion({
      system: 'Return valid JSON.',
      user: 'Test valid schema',
      schema,
    })).resolves.toMatchObject({
      suggestions: [{
        section: 'summary',
        suggestion: 'Short suggestion',
        reason: 'Clearer wording',
      }],
    });
  });
});
