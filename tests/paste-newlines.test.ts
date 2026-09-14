import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from '@vue-tui/testing';
import { expect, it, vi } from 'vitest';
import App from '../src/app.vue';
import * as clipboard from '../src/clipboard.js';
import { editorLines, insertText, normalizeEditorNewlines } from '../src/editor.js';
import { storeSettings } from '../src/settings.js';

it.each(['\n', '\r\n', '\r', '\v', '\f', '\u0085', '\u2028', '\u2029'])('normalizes incoming newline %j without losing empty lines', newline => {
  const state = insertText({ content: 'beforeXafter', cursor: 7, anchor: 6 }, `中文${newline}${newline}🙂${newline}`);
  expect(state.content).toBe('before中文\n\n🙂\nafter');
  expect(state.cursor).toBe('before中文\n\n🙂\n'.length);
  expect(editorLines(state)).toHaveLength(4);
  expect(editorLines(state).flatMap(line => line.cells).map(cell => cell.text).join('')).not.toContain('�');
});

it('preserves literal escape sequences, question marks, whitespace and non-newline text', () => {
  const text = '?? � literal \\r\\n\t  中文 👨‍👩‍👧\n';
  expect(normalizeEditorNewlines(text)).toBe(text);
});

it.each(['terminal', 'clipboard'] as const)('pastes %s newlines as real lines, supports undo/redo and saves LF', async source => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-paste-newlines-'));
  await writeFile(join(root, 'One.md'), 'original');
    await storeSettings(root, { autoSave: false, theme: 'lattice', language: 'en' });
  const payload = '中文\r\r第二行\r\n第三行\u2028第四行\u2029末行\v\n';
  const expected = '中文\n\n第二行\n第三行\n第四行\n末行\n\n';
  const spy = vi.spyOn(clipboard, 'readClipboard').mockResolvedValue({ text: payload });
  const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
    await result.stdin.write('\r');
    await result.stdin.write('\x01'); // select existing text
    await result.stdin.write(source === 'terminal' ? `\x1b[200~${payload}\x1b[201~` : '\x16');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('末行'));
    expect(result.lastFrame()).not.toContain('�');
    await result.stdin.write('/save\r');
    await vi.waitFor(async () => expect(await readFile(join(root, 'One.md'), 'utf8')).toBe(expected));
    await result.stdin.write('\x1a'); // undo is one paste, not individual lines
    await result.stdin.write('/save\r');
    await vi.waitFor(async () => expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('original'));
    await result.stdin.write('\x19');
    await result.stdin.write('/save\r');
    await vi.waitFor(async () => expect(await readFile(join(root, 'One.md'), 'utf8')).toBe(expected));
  } finally { result.dispose(); spy.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
