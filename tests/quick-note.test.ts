import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from '@vue-tui/testing';
import { expect, it, vi } from 'vitest';
import App from '../src/app.vue';
import { Vault } from '../src/vault.js';
import { preset, storeAIConfig } from '../src/ai.js';

it('configures a provider and stores its API key directly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-ai-settings-'));
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).not.toContain('Loading…'));
    await result.stdin.write('/model\r');
    expect(result.lastFrame()).toContain('AI MODEL CONFIGURATION');
    expect(result.lastFrame()).toContain('1 / 4');
    expect(result.lastFrame()).toContain('Use ←/→ to choose a provider preset.');
    await result.terminal.resize(60, 16);
    expect(result.lastFrame()).toContain('API KEY');
    expect(result.lastFrame()).toContain('next/save');
    await result.terminal.resize(100, 24);
    await result.stdin.write('\x1b[C');
    expect(result.lastFrame()).toContain('DeepSeek');
    await result.stdin.write('\r\x1b[Bcustom-model\rtest-api-key');
    expect(result.lastFrame()).not.toContain('test-api-key');
    expect(result.lastFrame()).toContain('••••');
    await result.stdin.write('\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('AI configuration saved'));
    expect(JSON.parse(await readFile(join(root, '.lattice/ai.json'), 'utf8'))).toEqual({ ...preset('DeepSeek'), model: 'custom-model', apiKey: 'test-api-key' });
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('captures, saves, confirms sending, reviews and saves a separate summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-jot-'));
  await storeAIConfig(root, preset('Ollama'));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '# Organized\n\n- Buy milk' } }] })));
  vi.stubGlobal('fetch', fetcher);
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).not.toContain('Loading…'));
    await result.stdin.write('/jot\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Quick note ·'));
    await result.stdin.write('Buy milk');
    await result.stdin.write('/save\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Saved Quick Notes/'));
    await result.stdin.write('\x1b');
    await result.stdin.write('/summarize\r');
    const [original] = await new Vault(root).loadNotes();
    expect(original!.title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(original!.relativePath).toMatch(/^Quick Notes\/\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.md$/);
    expect(result.lastFrame()).toContain('ORGANIZE WITH AI');
    expect(fetcher).not.toHaveBeenCalled();
    await result.stdin.write('\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('REVIEW ORGANIZED NOTE'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await new Vault(root).loadNotes()).length).toBe(1);
    await result.stdin.write('\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Summary saved separately'));
    expect(await readFile(original!.path, 'utf8')).toBe(original!.content);
    expect((await new Vault(root).loadNotes()).find(note => note.relativePath.includes('Summary'))?.content).toBe('# Organized\n\n- Buy milk\n');
  } finally { result.dispose(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});

it('shows a moving Lattice animation only while AI organization is pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-ai-loading-'));
  await storeAIConfig(root, preset('Ollama'));
  const vault = new Vault(root);
  const note = await vault.create('Ideas');
  await vault.save(note, '# Ideas\n\nA connected thought.\n');
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Ideas'));
    await result.stdin.write('/summarize\r');
    expect(result.lastFrame()).not.toContain('LATTICE · SYNTHESIS');
    await result.stdin.write('\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('LATTICE · SYNTHESIS'));
    expect(result.lastFrame()).toContain('Waiting for the model');
    const firstFrame = result.lastFrame();
    await vi.waitFor(() => expect(result.lastFrame()).not.toBe(firstFrame), { timeout: 1000 });
    expect(result.lastFrame()).toMatch(/[◆◇]──[◆◇]──[◆◇]──[◆◇]/);
    finish(new Response(JSON.stringify({ choices: [{ message: { content: '# Organized' } }] })));
    await vi.waitFor(() => expect(result.lastFrame()).toContain('REVIEW ORGANIZED NOTE'));
    expect(result.lastFrame()).not.toContain('LATTICE · SYNTHESIS');
  } finally { result.dispose(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});
