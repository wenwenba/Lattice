import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from '@vue-tui/testing';
import { expect, it, vi } from 'vitest';
import App from '../src/app.vue';

it('searches by tag and shows a matching context line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-search-ui-'));
  await writeFile(join(root, 'Work.md'), '# Work\nA searchable phrase #work');
  await writeFile(join(root, 'Home.md'), '# Home\nPrivate note #home');
  const result = await render(App, { columns: 100, rows: 28, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Work'));
    await result.stdin.write('/search\rtag:work searchable');
    const frame = result.lastFrame().replace(/\x1b\[[\d;]*m/g, '');
    expect(frame).toContain('SEARCH · 1');
    expect(frame).toContain('MATCH · A searchable phrase');
    expect(result.lastFrame()).not.toContain(' Home');
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('completes a wiki link and creates a missing target from the editor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-wiki-ui-'));
  await writeFile(join(root, 'Source.md'), '# Source\n');
  await writeFile(join(root, 'Target.md'), '# Target\n');
  const result = await render(App, { columns: 110, rows: 30, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain(' Source'));
    await result.stdin.write('\r[[Tar');
    expect(result.lastFrame()).toContain('LINK NOTE');
    expect(result.lastFrame()).toContain('Target.md');
    await result.stdin.write('\r');
    expect(result.lastFrame()).toContain('[[Target]]');
    await result.stdin.write(' [[Fresh');
    expect(result.lastFrame()).toContain('Enter creates this note');
    await result.stdin.write('\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('[[Fresh]]'));
    expect(await readFile(join(root, 'Fresh.md'), 'utf8')).toContain('# Fresh');
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('opens link health and contextual backlinks from slash commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-link-ui-'));
  await writeFile(join(root, 'A.md'), '# A\nSee [[B]] here.\n[[Missing]]');
  await writeFile(join(root, 'B.md'), '# B');
  const result = await render(App, { columns: 110, rows: 28, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('SELECTED · A.md'));
    await result.stdin.write('/links\r');
    expect(result.lastFrame()).toContain('UNRESOLVED WIKI LINKS');
    expect(result.lastFrame()).toContain('Missing');
    await result.stdin.write('\x1b');
    await result.stdin.write('\t');
    await result.stdin.write('\x1b[B');
    expect(result.lastFrame()).toContain('SELECTED · B.md');
    await result.stdin.write('/backlinks\r');
    expect(result.lastFrame()).toContain('BACKLINKS');
    expect(result.lastFrame()).toContain('See [[B]] here.');
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('extracts selected text into a linked note', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-extract-ui-'));
  await writeFile(join(root, 'Source.md'), '# Source\nSelected detail');
  const result = await render(App, { columns: 110, rows: 30, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('SELECTED · Source.md'));
    await result.stdin.write('\r');
    await result.stdin.write('\x01');
    await result.stdin.write('/extract-note');
    expect(result.lastFrame()).toContain('Extract to note');
    await result.stdin.write('\r');
    await vi.waitFor(async () => expect(await readFile(join(root, 'Source 2.md'), 'utf8')).toContain('Selected detail'));
    expect(result.lastFrame()).toContain('[[Source 2]]');
    await result.stdin.write('/save\r');
    await vi.waitFor(async () => expect(await readFile(join(root, 'Source.md'), 'utf8')).toBe('[[Source 2]]'));
  } finally { result.dispose(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
