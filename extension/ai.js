// ai.js — AI provider adapters for summary and tag generation

const DEBUG = false;

function log(...args) {
  if (DEBUG) console.log('[ShareTogether:AI]', ...args);
}

/**
 * Generate summary and tags from page content.
 * @param {Object} config - { provider, apiKey, model? }
 * @param {Object} page - { title, text, metaDescription }
 * @returns {Promise<{summary: string, tags: string[]}>}
 */
export async function generateSummaryAndTags(config, page) {
  log('provider:', config.provider, 'model:', config.model || 'default');
  log('page title:', page.title?.slice(0, 80));
  log('page text length:', page.text?.length || 0, 'chars');

  switch (config.provider) {
    case 'openai':
      return generateOpenAICompatible(config, page, 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini');
    case 'deepseek':
      return generateOpenAICompatible(config, page, 'https://api.deepseek.com/chat/completions', 'deepseek-v4-flash');
    case 'anthropic':
      return generateWithAnthropic(config, page);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

const SYSTEM_PROMPT = `You are a helpful assistant that summarizes web articles and suggests tags.
Given the title and text content of a web article, do two things:
1. Write a concise summary in 2-3 sentences. Keep it under 500 characters. Write in the same language as the article.
2. First, look through the eight predefined tags below and pick the ONE tag that best matches the article as a category. If NONE of the predefined tags fit, generate a suitable category tag instead. Then also generate 1-3 additional specific tags (lowercase, single words or short phrases) that describe the article's content.

Predefined category tags (pick exactly one):
- AI
- Web3与金融创新
- ESG与组织运营
- 经济金融与个人理财
- 育儿理念与身心健康
- 和儿子一起学STEAM
- 政府市场与社会科学
- 营销叙事与表达技巧

Tag rules:
- Always include exactly ONE category tag — from the predefined list if one fits, otherwise generate one.
- Also generate 1-3 additional freeform tags (lowercase, short phrases) describing the specific content.
- Total tags: 2-4 (1 category + 1-3 generated).

Return ONLY valid JSON in this exact format:
{"summary": "...", "tags": ["category", "tag1", "tag2"]}

Do not include any other text, markdown, or explanation.`;

function buildUserMessage(page) {
  const parts = [`Title: ${page.title || 'Untitled'}`];
  if (page.metaDescription) {
    parts.push(`Meta description: ${page.metaDescription}`);
  }
  parts.push(`Content:\n${page.text}`);
  return parts.join('\n\n');
}

// ---- OpenAI-compatible (OpenAI, DeepSeek, etc.) ----

async function generateOpenAICompatible(config, page, baseUrl, defaultModel) {
  const model = config.model || defaultModel;
  log('calling', baseUrl, 'model:', model);

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(page) }
      ],
      temperature: 0.3,
      max_tokens: 500
    })
  });

  log('response status:', response.status);

  if (!response.ok) {
    const err = await response.text();
    log('error response body:', err);
    throw new Error(`Provider: ${config.provider} | HTTP ${response.status}: ${err}`);
  }

  const data = await response.json();
  log('raw response:', JSON.stringify(data).slice(0, 500));
  return parseResponse(data.choices[0].message.content);
}

// ---- Anthropic ----

async function generateWithAnthropic(config, page) {
  const model = config.model || 'claude-3-haiku-20240307';
  log('calling anthropic, model:', model);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildUserMessage(page) }
      ]
    })
  });

  log('response status:', response.status);

  if (!response.ok) {
    const err = await response.text();
    log('error response body:', err);
    throw new Error(`Anthropic error ${response.status}: ${err}`);
  }

  const data = await response.json();
  log('raw response:', JSON.stringify(data).slice(0, 500));
  return parseResponse(data.content[0].text);
}

// ---- Response parsing ----

function parseResponse(raw) {
  // Try to extract JSON from code fences if present
  let json = raw.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    json = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(json);
  const result = {
    summary: (parsed.summary || '').trim().slice(0, 1000),
    tags: (parsed.tags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
  };
  log('parsed result:', JSON.stringify(result));
  return result;
}
