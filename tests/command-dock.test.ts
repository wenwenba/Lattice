import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from '@vue-tui/testing';
import { expect, it, vi } from 'vitest';
import App from '../src/app.vue';
import { filterCommands } from '../src/command-menu.js';

it('prefers exact slash names and retains descriptive search', () => {
  const commands = [{ label: 'Quick note' }, { label: 'Settings' }, { label: 'Organize saved note with AI' }];
  expect(filterCommands(commands, '/jot')[0]?.label).toBe('Quick note');
  expect(filterCommands(commands, 'quick')[0]?.label).toBe('Quick note');
  expect(filterCommands(commands, 'unknown')).toEqual([]);
});

it('renders bottom suggestions, completes, executes and preserves document text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-dock-'));
  await writeFile(join(root, 'One.md'), '# One');
  const result = await render(App, { columns: 80, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('◇ One'));
    await result.stdin.write('/sett\t');
    let screen = await result.screen();
    expect(screen.lines.some(line => line.includes('❯ /settings'))).toBe(true);
    expect(screen.lines.findIndex(line => line.includes('/settings · Settings'))).toBeGreaterThan(10);
    expect(screen.lines.some(line => line.includes('◆ COMMANDS'))).toBe(true);
    await result.stdin.write('\r');
    expect(result.lastFrame()).toContain('SETTINGS');
    await result.stdin.write('\x1b');
    await result.stdin.write('/does-not-exist\r');
    expect(result.lastFrame()).toContain('No matching command');
    await result.stdin.write('\x1b');
    await result.stdin.write('/');
    expect(result.lastFrame()).not.toContain('/keys');
    expect(result.lastFrame()).not.toContain('/select-all');
    expect(result.lastFrame()).not.toContain('/copy');
    await result.stdin.write('\x1b');
    await result.stdin.write('\r\x1b[200~ /literal\x1b[201~');
    await result.stdin.write('/save\r');
    await vi.waitFor(async () => expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('# One /literal'));
    await result.stdin.write('\x1b');
    await result.stdin.write('/');
    expect(result.lastFrame()).not.toContain('/save  Save note');
    expect(result.lastFrame()).not.toContain('/file  Insert vault file link');
    expect(result.lastFrame()).not.toContain('/image  Insert image');
    expect(result.lastFrame()).not.toContain('/preview  Preview');
    expect(result.lastFrame()).not.toContain('/backlinks  Backlinks');
    await result.stdin.write('\x1b[H\x1b[A');
    await result.terminal.resize(60, 16);
    screen = await result.screen();
    expect(screen.lines.some(line => line.includes('/quit'))).toBe(true);
    expect(screen.lines.some(line => line.includes('❯ /'))).toBe(true);
    expect(screen.lines.some(line => line.includes('run'))).toBe(true);
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});
