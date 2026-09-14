<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { TerminalProvider, TBox, TInput, TText, TView } from '@simon_he/vue-tui';
import { TInputBox } from '@simon_he/vue-tui/vue';
import { commandName, filterCommands } from '../src/command-menu';
import { commandTitle } from '../src/i18n';
import { icons } from '../src/icons';
import { buildSearchTree, buildVaultTree, type TreeItem } from '../src/tree';
import {
  createDefaultNotes,
  createDemoNote,
  normalizeNoteName,
  renderMarkdownPreview,
  updateDemoNote,
  wrapIndex,
  type DemoNote,
  type PreviewRow,
} from './demo-state';

type DemoMode = 'browse' | 'edit' | 'commands' | 'create' | 'search';
type DemoCommand = { label: string; title: string; run: () => void };

const STORAGE_KEY = 'lattice-web-demo-v3';
const COLS = 92;
const ROWS = 27;
const HEADER_H = 3;
const BODY_H = 17;
const COMMAND_BODY_H = 11;
const SIDEBAR_W = 27;
const EDITOR_W = Math.floor(COLS / 2);
const DOCK_Y = 20;
const FOOTER_Y = 24;

function loadNotes(): DemoNote[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed) && parsed.length && parsed.every((note) =>
      typeof note?.relativePath === 'string' && typeof note?.content === 'string')) return parsed;
  } catch {
    // A private browser session may block localStorage; the demo still works in memory.
  }
  return createDefaultNotes();
}

const notes = ref<DemoNote[]>(loadNotes());
const shell = ref<HTMLElement | null>(null);
const demoActive = ref(false);
const activeId = ref(notes.value[0]?.id ?? 'Welcome.md');
const selectedKey = ref(`note:${activeId.value}`);
const expandedFolders = ref(new Set(['Projects']));
const mode = ref<DemoMode>('browse');
const commandReturn = ref<'browse' | 'edit'>('browse');
const commandQuery = ref('');
const commandIndex = ref(0);
const createValue = ref('');
const searchQuery = ref('');
const helpVisible = ref(false);
const status = ref('已加载 3 篇笔记 · 1 个文件夹');

const activeNote = computed(() => notes.value.find((note) => note.id === activeId.value) ?? notes.value[0]!);
const folders = computed(() => [...new Set(notes.value.flatMap((note) => {
  const parts = note.relativePath.split('/');
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}))]);
const searchedNotes = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  return query
    ? notes.value.filter((note) => `${note.relativePath} ${note.content}`.toLocaleLowerCase().includes(query))
    : notes.value;
});
const sidebarItems = computed(() => mode.value === 'search'
  ? buildSearchTree(searchedNotes.value)
  : buildVaultTree(notes.value, folders.value, expandedFolders.value));
const surfaceMode = computed(() => mode.value === 'commands' ? commandReturn.value : mode.value);
const editing = computed(() => surfaceMode.value === 'edit');
const bodyHeight = computed(() => mode.value === 'commands' ? COMMAND_BODY_H : BODY_H);
const previewWidth = computed(() => editing.value ? COLS - EDITOR_W - 4 : COLS - SIDEBAR_W - 4);
const content = computed({
  get: () => activeNote.value.content,
  set: (value: string) => updateDemoNote(activeNote.value, value),
});
const previewRows = computed(() => renderMarkdownPreview(content.value, previewWidth.value, bodyHeight.value - 3));
const selectedPath = computed(() => activeNote.value.relativePath);

const commands = computed<DemoCommand[]>(() => [
  demoCommand('Quick note', createQuickNote),
  demoCommand('New note', enterCreate),
  demoCommand('Edit / preview', enterEdit),
  demoCommand('Search vault', enterSearch),
  demoCommand('Settings', () => { status.value = '设置通过 CLI 的 /settings 打开'; }),
  demoCommand('Keyboard help', showHelp),
  demoCommand('Reload vault', () => { status.value = '已重新加载浏览器演示 Vault'; }),
]);
const filteredCommands = computed(() => filterCommands(commands.value, commandQuery.value));
const selectedTreeIndex = computed(() => sidebarItems.value.findIndex((item) => item.key === selectedKey.value));
const treeWindowStart = computed(() => {
  const visibleRows = bodyHeight.value - 2;
  if (selectedTreeIndex.value < 0) return 0;
  return Math.max(0, Math.min(selectedTreeIndex.value - visibleRows + 1, sidebarItems.value.length - visibleRows));
});
const visibleSidebarItems = computed(() => sidebarItems.value.slice(
  treeWindowStart.value,
  treeWindowStart.value + bodyHeight.value - 2,
));
const commandWindowStart = computed(() => Math.max(0, commandIndex.value - 3));
const visibleCommands = computed(() => filteredCommands.value.slice(commandWindowStart.value, commandWindowStart.value + 4));

watch(notes, (value) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    if (mode.value === 'edit') status.value = `正在编辑 ${activeNote.value.title} · 已自动保存`;
  } catch {
    status.value = '当前浏览器禁止本地存储，内容仅在本页保留';
  }
}, { deep: true });

watch(filteredCommands, (value) => {
  commandIndex.value = value.length ? Math.min(commandIndex.value, value.length - 1) : 0;
});

watch(commandQuery, () => {
  commandIndex.value = 0;
});

function demoCommand(label: string, run: () => void): DemoCommand {
  return { label, title: commandTitle('zh-CN', label), run };
}

function enterEdit(): void {
  helpVisible.value = false;
  mode.value = 'edit';
  status.value = `正在编辑 ${activeNote.value.title} · 实时预览`;
}

function leaveEdit(): void {
  mode.value = 'browse';
  status.value = `已退出编辑 · 已选择 ${activeNote.value.relativePath}`;
}

function focusTreeItem(item: TreeItem): void {
  selectedKey.value = item.key;
  helpVisible.value = false;
  if (item.kind === 'note') {
    activeId.value = item.note.id;
    status.value = `已选择 ${item.relativePath}`;
  } else {
    status.value = `已选择文件夹 ${item.relativePath}`;
  }
}

function toggleFolder(item: Extract<TreeItem, { kind: 'folder' }>, expanded = !item.expanded): void {
  const next = new Set(expandedFolders.value);
  if (expanded) next.add(item.relativePath);
  else next.delete(item.relativePath);
  expandedFolders.value = next;
  status.value = `${expanded ? '已展开' : '已折叠'} ${item.relativePath}`;
}

function selectTreeItem(item: TreeItem): void {
  focusTreeItem(item);
  if (item.kind === 'folder') {
    toggleFolder(item);
    return;
  }
  enterEdit();
}

function moveTreeSelection(delta: number): void {
  const items = sidebarItems.value;
  if (!items.length) return;
  const current = selectedTreeIndex.value;
  const nextIndex = current < 0
    ? (delta < 0 ? items.length - 1 : 0)
    : wrapIndex(current, delta, items.length);
  focusTreeItem(items[nextIndex]!);
}

function activateTreeSelection(): void {
  const item = sidebarItems.value[selectedTreeIndex.value];
  if (item) selectTreeItem(item);
}

function resizeSelectedFolder(expand: boolean): void {
  const item = sidebarItems.value[selectedTreeIndex.value];
  if (!item || item.kind !== 'folder' || item.expanded === expand) return;
  toggleFolder(item, expand);
}

function treeRowText(item: TreeItem): string {
  const selected = item.key === selectedKey.value;
  const indent = '  '.repeat(item.depth);
  const marker = selected ? `${icons.selected} ` : '  ';
  const icon = item.kind === 'folder'
    ? `${item.expanded ? icons.expanded : icons.collapsed} ${icons.folder}`
    : `  ${icons.note}`;
  return `${indent}${marker}${icon} ${item.label}`;
}

function treeRowStyle(item: TreeItem) {
  const selected = item.key === selectedKey.value;
  return selected
    ? { fg: 'black', bg: 'cyanBright', bold: true }
    : { fg: item.kind === 'folder' ? 'yellow' : 'cyan', bold: item.kind === 'folder' };
}

function openCommands(): void {
  commandReturn.value = mode.value === 'edit' ? 'edit' : 'browse';
  mode.value = 'commands';
  commandQuery.value = '';
  commandIndex.value = 0;
  status.value = '命令面板';
}

function runCommand(command = filteredCommands.value[commandIndex.value]): void {
  if (!command) {
    status.value = '没有匹配的命令';
    return;
  }
  mode.value = commandReturn.value;
  commandQuery.value = '';
  command.run();
}

function handleCommandKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const length = filteredCommands.value.length;
  if (!length) return;
  commandIndex.value = wrapIndex(commandIndex.value, event.key === 'ArrowUp' ? -1 : 1, length);
}

function enterCreate(): void {
  helpVisible.value = false;
  createValue.value = '';
  mode.value = 'create';
  status.value = '输入新笔记名称';
}

function createNote(value = createValue.value): void {
  let relativePath = normalizeNoteName(value);
  let suffix = 2;
  while (notes.value.some((note) => note.relativePath === relativePath)) {
    relativePath = normalizeNoteName(`${value || 'Untitled'} ${suffix++}`);
  }
  const note = createDemoNote(relativePath);
  notes.value.push(note);
  activeId.value = note.id;
  selectedKey.value = `note:${note.id}`;
  enterEdit();
}

function createQuickNote(): void {
  const now = new Date();
  const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const note = createDemoNote(`随记-${stamp}.md`, `# 随记 · ${stamp}\n\n`);
  notes.value.push(note);
  activeId.value = note.id;
  selectedKey.value = `note:${note.id}`;
  enterEdit();
}

function enterSearch(): void {
  helpVisible.value = false;
  searchQuery.value = '';
  mode.value = 'search';
  status.value = '搜索标题和内容';
}

function openSearchResult(): void {
  const item = sidebarItems.value[selectedTreeIndex.value]
    ?? sidebarItems.value.find((entry) => entry.kind === 'note');
  if (item) selectTreeItem(item);
  else status.value = '没有匹配结果';
}

function showHelp(): void {
  helpVisible.value = true;
  mode.value = 'browse';
  status.value = '键盘帮助';
}

function handleShellKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (mode.value === 'commands') mode.value = commandReturn.value;
    else if (mode.value === 'edit') leaveEdit();
    else if (mode.value === 'create' || mode.value === 'search') mode.value = 'browse';
    else return;
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (mode.value === 'commands') {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      handleCommandKeydown(event);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      runCommand();
    }
    return;
  }

  if (mode.value === 'browse' || mode.value === 'search') {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveTreeSelection(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      resizeSelectedFolder(event.key === 'ArrowRight');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (mode.value === 'search') openSearchResult();
      else activateTreeSelection();
      return;
    }
  }

  if (mode.value !== 'browse') return;
  if (event.key === '/') {
    event.preventDefault();
    event.stopPropagation();
    openCommands();
  } else if (event.key.toLocaleLowerCase() === 'e') {
    event.preventDefault();
    event.stopPropagation();
    enterEdit();
  }
}

function handleWindowPointer(event: PointerEvent): void {
  demoActive.value = Boolean(shell.value?.contains(event.target as Node));
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (demoActive.value) handleShellKeydown(event);
}

onMounted(() => {
  window.addEventListener('pointerdown', handleWindowPointer, true);
  window.addEventListener('keydown', handleWindowKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener('pointerdown', handleWindowPointer, true);
  window.removeEventListener('keydown', handleWindowKeydown, true);
});

function rowStyle(row: PreviewRow) {
  const text = row.text.trimStart();
  if (row.kind === 'heading') {
    if (text.startsWith('█')) return { fg: 'cyanBright', bold: true, underline: true };
    if (text.startsWith('▌')) return { fg: 'blueBright', bold: true };
    if (text.startsWith('◆')) return { fg: 'magentaBright', bold: true };
    return { fg: 'yellowBright', bold: true };
  }
  if (row.kind === 'code-header' || row.kind === 'code-footer') return { fg: 'gray', dim: true };
  if (row.kind === 'code') return { fg: 'green' };
  if (row.kind === 'table') return { fg: text.includes('─') ? 'gray' : 'whiteBright' };
  if (row.kind === 'quote') return { fg: 'gray' };
  if (row.kind === 'list' && text.startsWith('✓')) return { fg: 'greenBright' };
  if (row.kind === 'list' && text.startsWith('○')) return { fg: 'yellowBright' };
  if (row.kind === 'frontmatter') return { fg: 'magenta' };
  if (row.kind === 'rule') return { fg: 'gray', dim: true };
  return { fg: 'white' };
}
</script>

<template>
  <div ref="shell" class="terminal-shell terminal-demo-shell" tabindex="0">
    <div class="terminal-bar">
      <div class="traffic" aria-hidden="true"><i></i><i></i><i></i></div>
      <span>lattice — ~/Lattice Demo</span>
      <span class="live"><b></b>LIVE WEB DEMO</span>
    </div>
    <div class="demo-viewport" aria-label="可交互的 Lattice Web 演示">
      <TerminalProvider
        :cols="COLS"
        :rows="ROWS"
        :default-style="{ fg: 'white', bg: 'black' }"
        :selection="{ enabled: true, copyOnSelect: false, toast: true }"
      >
        <TText :x="1" :y="0" :w="70" :value="`◆ LATTICE · ~/Lattice Demo`" :style="{ fg: 'greenBright', bold: true }" />
        <TText :x="COLS - 13" :y="0" :w="12" :value="`${notes.length} 篇笔记`" :style="{ fg: 'gray' }" />
        <TText :x="1" :y="1" :w="COLS - 2" :value="`已选择 · ${selectedPath}`" :style="{ fg: 'cyan' }" />
        <TText :x="0" :y="2" :w="COLS" :value="'─'.repeat(COLS)" :style="{ fg: 'gray', dim: true }" />

        <template v-if="!editing">
          <TText :x="1" :y="HEADER_H" :w="SIDEBAR_W - 2" :value="mode === 'search' ? `搜索 · ${searchedNotes.length}` : `VAULT · ${folders.length}`" :style="{ fg: 'greenBright', bold: true }" />
          <TView
            v-for="(item, index) in visibleSidebarItems"
            :key="item.key"
            :x="0" :y="HEADER_H + 2 + index" :w="SIDEBAR_W - 1" :h="1"
            focusable
            @click="selectTreeItem(item)"
            @keydown.enter="selectTreeItem(item)"
          >
            <TText :x="0" :y="0" :w="SIDEBAR_W - 1" :value="treeRowText(item)" :style="treeRowStyle(item)" />
          </TView>
          <TText v-for="index in bodyHeight" :key="`divider-${index}`" :x="SIDEBAR_W - 1" :y="HEADER_H + index - 1" :w="1" value="│" :style="{ fg: 'gray', dim: true }" />

          <template v-if="helpVisible">
            <TText :x="SIDEBAR_W + 2" :y="HEADER_H" :w="COLS - SIDEBAR_W - 3" value="键盘帮助 · 应用功能使用 / 命令" :style="{ fg: 'cyanBright', bold: true }" />
            <TText :x="SIDEBAR_W + 2" :y="HEADER_H + 2" :w="COLS - SIDEBAR_W - 3" value="Enter   打开并编辑所选笔记" :style="{ fg: 'white' }" />
            <TText :x="SIDEBAR_W + 2" :y="HEADER_H + 3" :w="COLS - SIDEBAR_W - 3" value="e / q   进入编辑 / 退出 CLI" :style="{ fg: 'white' }" />
            <TText :x="SIDEBAR_W + 2" :y="HEADER_H + 4" :w="COLS - SIDEBAR_W - 3" value="/       打开命令面板" :style="{ fg: 'white' }" />
            <TText :x="SIDEBAR_W + 2" :y="HEADER_H + 5" :w="COLS - SIDEBAR_W - 3" value="Esc     退出编辑并聚焦 VAULT" :style="{ fg: 'white' }" />
          </template>
          <template v-else>
            <TText :x="SIDEBAR_W + 2" :y="HEADER_H" :w="COLS - SIDEBAR_W - 3" :value="`${activeNote.title} · thumbnail`" :style="{ fg: 'whiteBright', bold: true }" />
            <TText
              v-for="(row, index) in previewRows"
              :key="`${index}-${row.text}`"
              :x="SIDEBAR_W + 2" :y="HEADER_H + 2 + index" :w="COLS - SIDEBAR_W - 3" :h="1"
              :value="row.text" :style="rowStyle(row)"
            />
          </template>
        </template>

        <template v-else>
          <TInputBox
            :x="0" :y="HEADER_H" :w="EDITOR_W" :h="bodyHeight"
            :title="` EDIT · ${activeNote.title} `"
            v-model="content"
            placeholder="在这里输入 Markdown…"
            :style="{ fg: 'whiteBright', bg: 'black' }"
            :auto-focus="mode === 'edit'"
            cursor-shape="bar"
          />
          <TBox
            :x="EDITOR_W" :y="HEADER_H" :w="COLS - EDITOR_W" :h="bodyHeight"
            border title=" LIVE PREVIEW · thumbnail " :padding="1"
            :style="{ fg: 'gray', bg: 'black' }" :title-style="{ fg: 'cyanBright', bold: true }"
          >
            <TText
              v-for="(row, index) in previewRows"
              :key="`${index}-${row.text}`"
              :x="0" :y="index" :w="COLS - EDITOR_W - 4" :h="1"
              :value="row.text" :style="rowStyle(row)"
            />
          </TBox>
        </template>

        <TBox
          v-if="mode === 'commands'"
          :x="0" :y="HEADER_H + bodyHeight" :w="COLS" :h="6"
          border title=" ◆ 命令 " :padding="0"
          :style="{ fg: 'gray', bg: 'black' }" :title-style="{ fg: 'cyanBright', bold: true }"
        >
          <TView
            v-for="(commandItem, index) in visibleCommands"
            :key="commandItem.label"
            :x="0" :y="index" :w="COLS - 2" :h="1"
            focusable
            @click="runCommand(commandItem)"
          >
            <TText
              :x="0" :y="0" :w="COLS - 2"
              :value="`${index + commandWindowStart === commandIndex ? ' › ' : '   '}/${commandName(commandItem.label)}  ·  ${commandItem.title}`"
              :style="index + commandWindowStart === commandIndex ? { fg: 'black', bg: 'cyanBright', bold: true } : { fg: 'white' }"
            />
          </TView>
        </TBox>

        <TBox :x="0" :y="DOCK_Y" :w="COLS" :h="4" border :style="{ fg: mode === 'commands' ? 'cyanBright' : 'gray', bg: 'black' }">
          <template v-if="mode === 'commands'">
            <TText :x="1" :y="0" :w="4" value="❯ /" :style="{ fg: 'cyanBright', bold: true }" />
            <TInput
              :x="4" :y="0" :w="COLS - 7" :h="1"
              v-model="commandQuery"
              placeholder="输入命令"
              :style="{ fg: 'whiteBright', bg: 'black' }"
              :auto-focus="true"
              :submit-on-enter="true"
              @change="runCommand()"
            />
          </template>
          <template v-else-if="mode === 'create'">
            <TText :x="1" :y="0" :w="8" value="新建 › " :style="{ fg: 'cyanBright', bold: true }" />
            <TInput
              :x="8" :y="0" :w="COLS - 11" :h="1"
              v-model="createValue"
              placeholder="笔记名称"
              :style="{ fg: 'whiteBright', bg: 'black' }"
              :auto-focus="true"
              :submit-on-enter="true"
              @change="createNote"
            />
          </template>
          <template v-else-if="mode === 'search'">
            <TText :x="1" :y="0" :w="4" value="/ " :style="{ fg: 'cyanBright', bold: true }" />
            <TInput
              :x="3" :y="0" :w="COLS - 6" :h="1"
              v-model="searchQuery"
              placeholder="搜索标题和内容"
              :style="{ fg: 'whiteBright', bg: 'black' }"
              :auto-focus="true"
              :submit-on-enter="true"
              @change="openSearchResult"
            />
          </template>
          <TView v-else :x="0" :y="0" :w="COLS - 2" :h="2" focusable @click="openCommands">
            <TText :x="1" :y="0" :w="COLS - 4" :value="mode === 'edit' ? '❯ Esc 返回浏览，然后按 / 打开命令' : '❯ 输入 / 打开命令'" :style="{ fg: 'gray' }" />
          </TView>
        </TBox>

        <TText :x="1" :y="FOOTER_Y" :w="COLS - 2" :value="status" :style="{ fg: 'gray' }" />
        <TText
          :x="1" :y="FOOTER_Y + 1" :w="COLS - 2"
          :value="mode === 'edit' ? '⌃F/R 查找/替换 · ⌃A/C/X/V 文本操作 · /save' : 'e 编辑 · q 退出 · / 命令 · /jot 随记 · /settings 设置'"
          :style="{ fg: 'gray', dim: true }"
        />
      </TerminalProvider>
    </div>
    <p class="demo-help">点击 Demo 后，↑↓ 循环选择 · ←→ 展开/折叠 · Enter 打开 · Esc 返回 Vault · / 命令</p>
  </div>
</template>
