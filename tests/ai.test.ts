import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAIConfig, storeAIConfig, preset, summarize, validateConfig } from '../src/ai.js';

afterEach(() => { vi.unstubAllGlobals(); });
it.each(['OpenAI', 'DeepSeek', 'Qwen', 'Zhipu', 'Claude', 'Gemini', 'Ollama', 'Custom'] as const)('adapts %s requests', async provider => {
  const config = { ...preset(provider), model: 'test-model', apiKey: provider === 'Ollama' || provider === 'Custom' ? '' : 'test-secret' };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: '# Summary' } }], content: [{ type: 'text', text: '# Summary' }],
    candidates: [{ content: { parts: [{ text: '# Summary' }] } }],
  })));
  vi.stubGlobal('fetch', fetcher);
  expect(await summarize(config, 'Original note')).toBe('# Summary');
  const [url, request] = fetcher.mock.calls[0]!;
  expect(url).toContain(provider === 'Claude' ? '/messages' : provider === 'Gemini' ? ':generateContent' : '/chat/completions');
  expect(request.body).toContain('Original note');
  expect(request.redirect).toBe('error');
  if (config.apiKey) expect(Object.values(request.headers)).toContain(provider === 'Claude' || provider === 'Gemini' ? 'test-secret' : 'Bearer test-secret');
});
it('persists the API key in the private vault configuration and rejects the old format', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-ai-'));
  try {
    expect(await loadAIConfig(root)).toEqual(preset('OpenAI'));
    const config = { ...preset('OpenAI'), apiKey: 'stored-key' };
    await storeAIConfig(root, config);
    expect(await loadAIConfig(root)).toEqual(config);
    expect(await readFile(join(root, '.lattice/ai.json'), 'utf8')).toContain('stored-key');
    const { apiKey: _, ...oldConfig } = preset('OpenAI');
    await expect(storeAIConfig(root, { ...oldConfig, keyEnv: 'OPENAI_API_KEY' } as never)).rejects.toThrow('old AI configuration');
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('validates endpoints, missing keys and size before sending', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(() => validateConfig({ ...preset('OpenAI'), apiKey: 'key', baseURL: 'http://example.com/v1' })).toThrow();
  expect(() => validateConfig({ ...preset('OpenAI'), apiKey: 'key', baseURL: 'https://secret@example.com/v1' })).toThrow();
  await expect(summarize(preset('OpenAI'), 'note')).rejects.toThrow('API key');
  await expect(summarize(preset('Ollama'), 'x'.repeat(200001))).rejects.toThrow('200 KB');
  await expect(summarize(preset('Ollama'), ' ')).rejects.toThrow('empty');
  expect(fetcher).not.toHaveBeenCalled();
});
it('handles provider errors without exposing their response body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive error', { status: 401 })));
  await expect(summarize(preset('Ollama'), 'note')).rejects.toThrow('HTTP 401');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(summarize(preset('Ollama'), 'note')).rejects.toThrow('no text');
});
it('propagates cancellation and rejects truncated output', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_url, request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason));
  })));
  const pending = summarize(preset('Ollama'), 'note', controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }))));
  await expect(summarize(preset('Ollama'), 'note')).rejects.toThrow('truncated');
});
