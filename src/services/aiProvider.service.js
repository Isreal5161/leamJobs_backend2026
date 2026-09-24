export class AiProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'AiProviderError';
    this.publicCode = code;
    this.status = status;
  }
}

const getSettings = () => ({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 30000),
});

export const requestStructuredCompletion = async ({ system, user, schema }) => {
  const settings = getSettings();
  if (!settings.apiKey) {
    throw new AiProviderError('AI_NOT_CONFIGURED', 'AI assistance is not configured yet.', 503);
  }
  if (!Number.isFinite(settings.timeoutMs) || settings.timeoutMs < 1000 || settings.timeoutMs > 120000) {
    throw new AiProviderError('AI_CONFIGURATION_INVALID', 'AI assistance configuration is invalid.', 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorInfo = payload?.error ?? payload;
      const safeErrorMessage = typeof errorInfo?.message === 'string' ? errorInfo.message : (typeof errorInfo?.error === 'string' ? errorInfo.error : null);
      const diagnostic = [
        safeErrorMessage,
        typeof errorInfo?.type === 'string' ? `type=${errorInfo.type}` : null,
        typeof errorInfo?.code === 'string' ? `code=${errorInfo.code}` : null,
        typeof errorInfo?.param === 'string' ? `param=${errorInfo.param}` : null,
      ].filter(Boolean).join(', ');
      console.error(`AI provider upstream failure: status=${response.status}${diagnostic ? `, error=${diagnostic}` : ''}`);
      throw new AiProviderError('AI_PROVIDER_FAILED', 'AI assistance is temporarily unavailable.', 502);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new AiProviderError('AI_INVALID_RESPONSE', 'AI assistance returned no usable result.', 502);
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw new AiProviderError('AI_INVALID_RESPONSE', 'AI assistance returned an invalid result.', 502); }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new AiProviderError('AI_INVALID_RESPONSE', 'AI assistance returned an invalid result.', 502);
    return result.data;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error?.name === 'AbortError') throw new AiProviderError('AI_TIMEOUT', 'AI assistance timed out. Please try again.', 504);
    throw new AiProviderError('AI_PROVIDER_FAILED', 'AI assistance is temporarily unavailable.', 502);
  } finally {
    clearTimeout(timeout);
  }
};
