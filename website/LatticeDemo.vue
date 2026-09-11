<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { TerminalProvider, TBox, TInput, TText, TView } from '@simon_he/vue-tui';
import { TInputBox } from '@simon_he/vue-tui/vue';
import {
  createDefaultNotes,
  normalizeNoteName,
  renderMarkdownPreview,
  type DemoNote,
  type PreviewRow,
} from './demo-state';
import { icons, treeEntryIcon } from '../src/icons';

const STORAGE_KEY = 'lattice-web-demo-v1';
const COLS = 80;
const ROWS = 25;
const VAULT_W = 18;
const EDITOR_W = 34;
const PREVIEW_W = COLS - VAULT_W - EDITOR_W;

function loadNotes(): DemoNote[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // A private browser session may block localStorage; the demo still works in memory.
  }
  return createDefaultNotes();
}

const notes = ref<DemoNote[]>(loadNotes());
const activeId = ref(notes.value[0]?.id ?? 'welcome');
const command = ref('');
const status = ref('WEB DEMO · 自动保存到浏览器本地');

const activeNote = computed(() => notes.value.find((note) => note.id === activeId.value) ?? notes.value[0]!);
const content = computed({
  get: () => activeNote.value.content,
  set: (value: string) => {
    activeNote.value.content = value;
  },
});
const previewRows = computed(() => renderMarkdownPreview(content.value, PREVIEW_W - 4, 18));

watch(notes, (value) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    status.value = '当前浏览器禁止本地存储，内容仅在本页保留';
  }
}, { deep: true });

function selectNote(note: DemoNote): void {
  activeId.value = note.id;
  status.value = `已打开 ${note.name}`;
}

function runCommand(value: string): void {
  const input = value.trim();
  command.value = '';
  if (!input) return;

  const [name, ...args] = input.split(/\s+/u);
  if (name === '/new') {
    const noteName = normalizeNoteName(args.join(' '));
    const note: DemoNote = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: noteName,
      content: `# ${noteName.replace(/\.md$/iu, '')}\n\n`,
    };
    notes.value.push(note);
    activeId.value = note.id;
    status.value = `已创建 ${noteName}`;
    return;
  }

  if (name === '/clear') {
    content.value = '';
    status.value = `已清空 ${activeNote.value.name}`;
    return;
  }

  if (name === '/reset') {
    notes.value = createDefaultNotes();
    activeId.value = notes.value[0]!.id;
    status.value = '演示 Vault 已重置';
    return;
  }

  if (name === '/open') {
    const wanted = args.join(' ').toLocaleLowerCase();
    const match = notes.value.find((note) => note.name.toLocaleLowerCase().includes(wanted));
    if (match) selectNote(match);
    else status.value = `未找到：${args.join(' ') || '文件名'}`;
    return;
  }

  if (name === '/help') {
    status.value = '/new [名称] · /open [名称] · /clear · /reset';
    return;
  }

  status.value = `未知命令 ${name}，输入 /help 查看可用命令`;
}

function rowStyle(kind: PreviewRow['kind']) {
  if (kind === 'heading1') return { fg: 'whiteBright', bold: true };
  if (kind === 'heading2') return { fg: 'cyanBright', bold: true };
  if (kind === 'heading3') return { fg: 'blueBright', bold: true };
  if (kind === 'task') return { fg: 'greenBright' };
  if (kind === 'quote') return { fg: 'cyan', dim: true };
  if (kind === 'code') return { fg: 'green' };
  if (kind === 'table') return { fg: 'yellowBright' };
  return { fg: 'white' };
}
</script>

<template>
  <div class="terminal-shell terminal-demo-shell">
    <div class="terminal-bar">
      <div class="traffic" aria-hidden="true"><i></i><i></i><i></i></div>
      <span>lattice — web-vault</span>
      <span class="live"><b></b>{{ status }}</span>
    </div>
    <div class="demo-viewport" aria-label="可交互的 Lattice Web 演示">
      <TerminalProvider
        :cols="COLS"
        :rows="ROWS"
        :default-style="{ fg: 'white', bg: 'black' }"
        :selection="{ enabled: true, copyOnSelect: false, toast: true }"
      >
        <TBox
          :x="0" :y="0" :w="VAULT_W" :h="22" border title=" VAULT " :padding="1"
          :style="{ fg: 'gray', bg: 'black' }" :title-style="{ fg: 'cyanBright', bold: true }"
        >
          <TText :x="0" :y="0" :w="VAULT_W - 4" :value="`${treeEntryIcon('folder', true)} demo/`" :style="{ fg: 'gray', dim: true }" />
          <TView
            v-for="(note, index) in notes.slice(0, 8)"
            :key="note.id"
            :x="0" :y="index + 2" :w="VAULT_W - 4" :h="1" focusable
            @click="selectNote(note)"
            @keydown.enter="selectNote(note)"
          >
            <TText
              :x="0" :y="0" :w="VAULT_W - 4"
              :value="`${icons.note} ${note.name}`"
              :style="note.id === activeId
                ? { fg: 'black', bg: 'cyanBright', bold: true }
                : { fg: 'white' }"
            />
          </TView>
        </TBox>

        <TInputBox
          :x="VAULT_W" :y="0" :w="EDITOR_W" :h="22" :padding="1"
          :title="` EDITOR · ${activeNote.name} `"
          v-model="content"
          placeholder="在这里输入 Markdown…"
          :style="{ fg: 'whiteBright', bg: 'black' }"
          :auto-focus="true"
          cursor-shape="bar"
        />

        <TBox
          :x="VAULT_W + EDITOR_W" :y="0" :w="PREVIEW_W" :h="22" border title=" PREVIEW · LIVE " :padding="1"
          :style="{ fg: 'gray', bg: 'black' }" :title-style="{ fg: 'cyanBright', bold: true }"
        >
          <TText
            v-for="(row, index) in previewRows"
            :key="`${index}-${row.text}`"
            :x="0" :y="index" :w="PREVIEW_W - 4" :h="1"
            :value="row.text" :style="rowStyle(row.kind)"
          />
        </TBox>

        <TBox
          :x="0" :y="22" :w="COLS" :h="3" border title=" / COMMAND "
          :style="{ fg: 'gray', bg: 'black' }" :title-style="{ fg: 'cyanBright', bold: true }"
        >
          <TInput
            :x="0" :y="0" :w="COLS - 2" :h="1" v-model="command"
            placeholder="/new 名称 · /open 文件 · /clear · /reset · /help"
            :style="{ fg: 'whiteBright', bg: 'black' }"
            :submit-on-enter="true"
            @change="runCommand"
          />
        </TBox>
      </TerminalProvider>
    </div>
    <p class="demo-help">点击文件切换 · 点击编辑区输入 · 下方输入斜杠命令 · 内容仅保存在当前浏览器</p>
  </div>
</template>
