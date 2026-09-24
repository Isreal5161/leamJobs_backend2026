import { jest } from '@jest/globals';

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
});
