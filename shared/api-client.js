const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-20250514';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

class OpenRouterClient {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODEL;
  }

  async generateCompletion(prompt, options = {}) {
    const body = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature !== undefined ? options.temperature : 0.7
    };

    let response;
    try {
      response = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      throw new Error(`Network error calling OpenRouter: ${err.message}`);
    }

    if (!response.ok) {
      let errorMsg = `OpenRouter API error (${response.status})`;
      try {
        const errorBody = await response.json();
        if (errorBody.error && errorBody.error.message) {
          errorMsg += `: ${errorBody.error.message}`;
        }
      } catch (_) {
        // Could not parse error body
      }

      if (response.status === 429) {
        const retryAfter = response.headers && response.headers.get
          ? response.headers.get('retry-after')
          : null;
        if (retryAfter) {
          errorMsg += ` (retry after ${retryAfter}s)`;
        }
      }

      throw new Error(errorMsg);
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';

    const usage = data.usage || {};
    return {
      content,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0
      }
    };
  }
}

function getApiClient(apiKey, model) {
  return new OpenRouterClient(apiKey, model);
}

// Module export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpenRouterClient, getApiClient, DEFAULT_MODEL };
} else {
  const globalScope = typeof self !== 'undefined' ? self : window;
  Object.assign(globalScope, { OpenRouterClient, getApiClient, DEFAULT_MODEL });
}
