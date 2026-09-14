<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, shallowRef, watch, watchEffect } from "vue";
import { Box, Text, useApp, useInput, useLayoutSize, useBoxMetrics, type Color, type TuiInputEvent } from "@vue-tui/runtime";
import { backspace, deleteForward, deleteWord, editorLines, insertText, moveCursor, selectionRange, selectedText, selectAll, setCursor, cursorAtPoint, cursorColumn, cursorCellWidth, EditorHistory, type EditorState } from "./editor.js";
import { markdownVaultFileLink, terminalHyperlink } from "./links.js";
import { renderMarkdown, wrapRenderLine } from "./markdown.js";
import { ImagePreviewCache, isImageFile } from "./images.js";
import { resolveEditorShortcut, hasNonShiftModifier, isControlKey, keymapPlatform, type EditorShortcut, type Keymap } from "./shortcuts.js";
import { applySlashCommand, filterSlashCommands } from "./slash.js";
import { buildSearchTree, buildVaultTree, parentFolder, type TreeItem } from "./tree.js";
import type { AppMode, FocusPane, MainView, Note, StyledSegment, VaultFile, RenderLine } from "./types.js";
import { Vault } from "./vault.js";
import { readClipboard, writeClipboardText } from "./clipboard.js";
import { MOUSE_INPUT, type MouseEvent } from "./mouse.js";
import type { TuiKey } from "@vue-tui/runtime";
import { storeClipboardImage } from "./attachments.js";
import { KITTY_GRAPHICS } from "./graphics.js";
import { pathToFileURL } from "node:url";
import { defaultSettings, loadSettings, storeSettings, themes, type Settings } from './settings.js';
import { commandTitle, languages, slashDescription as localizedSlashDescription, slashTitle as localizedSlashTitle, translate } from './i18n.js';
import { commandName, filterCommands } from './command-menu.js';
import { importLocal } from './import.js';
import { quickNoteTime } from './quick-note.js';
import stringWidth from 'string-width';
import { loadAIConfig, storeAIConfig, preset, providers, summarize, type AIConfig } from './ai.js';
import { useFindReplace } from './find-replace.js';
import { icons, vaultFileKind, type VaultIconKind } from './icons.js';

const aiConfig = shallowRef<AIConfig>(preset('OpenAI'));
const aiField = shallowRef(0);
const aiFields = ['provider', 'baseURL', 'model', 'apiKey'] as const;
const aiLabels = computed(() => [ui('PROVIDER', '服务商'), ui('API BASE URL', 'API 地址'), ui('MODEL', '模型'), ui('API KEY', 'API 密钥')]);
const aiHelp = computed(() => [
  ui('Use ←/→ to choose a provider preset.', '使用 ←/→ 选择服务商预设。'),
  ui('Requests are sent to this endpoint.', '请求将发送到此地址。'),
  ui('Enter the exact model ID exposed by the provider.', '输入服务商提供的准确模型 ID。'),
  ui('Type or paste the key directly; it stays masked on screen.', '直接输入或粘贴密钥；密钥会始终遮挡显示。'),
]);
const aiDraft = shallowRef<AIConfig>(preset('OpenAI'));
const aiResult = shallowRef('');
const aiScroll = shallowRef(0);
const aiBusy = shallowRef(false);
const aiLoadingFrames = ['◆──◇──◇──◇', '◇──◆──◇──◇', '◇──◇──◆──◇', '◇──◇──◇──◆'] as const;
const aiLoadingStep = shallowRef(0);
const aiLoadingFrame = computed(() => aiLoadingFrames[aiLoadingStep.value % aiLoadingFrames.length]);
const aiLoadingMessage = computed(() => `${ui('Mapping ideas', '正在梳理内容')}${'.'.repeat(aiLoadingStep.value % 4 + 1)}`);
const aiReplaceField = shallowRef(true);
const aiFieldValue = (field: typeof aiFields[number]) => field === 'apiKey' ? '•'.repeat(Math.min(32, aiDraft.value.apiKey.length)) : aiDraft.value[field];
let aiSource: Note | undefined;
let aiAbort: AbortController | undefined;
let aiLoadingTimer: ReturnType<typeof setInterval> | undefined;
let aiReturn: AppMode = 'browse';
const aiLines = computed(() => aiResult.value.split('\n').flatMap(line => {
  const chunks: string[] = []; let chunk = '';
  for (const character of line) {
    if (stringWidth(chunk + character) > Math.max(1, layout.width.value - 6)) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  chunks.push(chunk); return chunks;
}));
function openAIConfig() {
  aiDraft.value = { ...aiConfig.value }; aiField.value = 0; aiReplaceField.value = true;
  aiReturn = mode.value === 'edit' ? 'edit' : 'browse';
  closeSlashMenu(); mode.value = 'ai-config';
}
async function quickNote() {
  if (!canNavigateAway() || saveInProgress) return;
  aiBusy.value = true;
  try {
    const stamp = quickNoteTime();
    const note = await vault.create(`Quick Notes/${stamp.filename}`);
    await vault.save(note, `# ${stamp.title}\n\n`);
    await refreshVault(note.id); enterEdit(); status.value = ui('Quick note · write freely · /save to save · /summarize to organize', '随记 · 自由记录 · /save 保存 · /summarize 使用 AI 整理');
  } catch (error) { status.value = `${ui('Quick note failed', '创建随记失败')}: ${errorMessage(error)}`; }
  finally { aiBusy.value = false; }
}
function openAIReview() {
  if (isDirty.value || saveInProgress) { status.value = ui('Save the note first (/save), then /summarize', '请先使用 /save 保存笔记，再执行 /summarize'); return; }
  const note = activeNote.value;
  if (!note || !note.content.trim()) { status.value = ui('Choose a non-empty saved note', '请选择一篇非空且已保存的笔记'); return; }
  aiSource = { ...note }; aiResult.value = ''; aiScroll.value = 0;
  aiReturn = mode.value === 'edit' ? 'edit' : 'browse';
  closeSlashMenu(); mode.value = 'ai-review';
}
function startAILoading() {
  if (aiLoadingTimer) clearInterval(aiLoadingTimer);
  aiLoadingStep.value = 0;
  aiLoadingTimer = setInterval(() => { aiLoadingStep.value++; }, 180);
}
function stopAILoading() {
  if (aiLoadingTimer) clearInterval(aiLoadingTimer);
  aiLoadingTimer = undefined;
}
async function handleAI(event: TuiInputEvent) {
  if (event.type === 'key' && event.key.name === 'escape') {
    if (aiBusy.value) { aiAbort?.abort(); return; }
    mode.value = aiReturn; return;
  }
  if (aiBusy.value) return;
  if (mode.value === 'ai-config') {
    const field = aiFields[aiField.value]!;
    if (event.type === 'key') {
      const key = event.key;
      if (key.name === 'up' || key.name === 'down' || key.name === 'tab') {
        aiField.value = wrapIndex(aiField.value, key.name === 'up' ? -1 : 1, aiFields.length); aiReplaceField.value = true; return;
      }
      if (key.name === 'enter') {
        if (aiField.value < aiFields.length - 1) { aiField.value++; aiReplaceField.value = true; return; }
        aiBusy.value = true;
        try { await storeAIConfig(vault.root, aiDraft.value); aiConfig.value = { ...aiDraft.value }; mode.value = aiReturn; status.value = ui('AI configuration saved', 'AI 配置已保存'); }
        catch (error) { status.value = `${ui('AI config failed', 'AI 配置失败')}: ${errorMessage(error)}`; }
        finally { aiBusy.value = false; }
        return;
      }
      if (field === 'provider' && ['left', 'right'].includes(key.name ?? '')) {
        const names = Object.keys(providers) as AIConfig['provider'][];
        aiDraft.value = preset(names[(names.indexOf(aiDraft.value.provider) + (key.name === 'left' ? names.length - 1 : 1)) % names.length]!);
        aiReplaceField.value = true; return;
      }
      if (field !== 'provider') {
        if (isControlKey(key, 'u')) { aiDraft.value = { ...aiDraft.value, [field]: '' }; aiReplaceField.value = false; }
        if (key.name === 'backspace') {
          aiDraft.value = { ...aiDraft.value, [field]: aiReplaceField.value ? '' : aiDraft.value[field].slice(0, -1) };
          aiReplaceField.value = false;
        }
      }
    } else if (field !== 'provider' && (event.type === 'text' || event.type === 'paste')) {
      const text = event.text.replace(/[\x00-\x1f\x7f]/g, '');
      aiDraft.value = { ...aiDraft.value, [field]: aiReplaceField.value ? text : aiDraft.value[field] + text };
      aiReplaceField.value = false;
    }
    return;
  }
  if (event.type !== 'key') return;
  const key = event.key.name;
  const step = key === 'page-up' || key === 'page-down' ? Math.max(1, bodyHeight.value - 5) : 1;
  if (['up', 'down', 'page-up', 'page-down', 'home', 'end'].includes(key ?? '')) {
    const max = Math.max(0, aiLines.value.length - Math.max(1, bodyHeight.value - 5));
    aiScroll.value = key === 'home' ? 0 : key === 'end' ? max : Math.max(0, Math.min(max, aiScroll.value + (key === 'up' || key === 'page-up' ? -step : step))); return;
  }
  if (key !== 'enter' || !aiSource) return;
  aiBusy.value = true;
  try {
    if (!aiResult.value) {
      aiAbort = new AbortController(); status.value = ui('Organizing… Esc cancels', '正在整理… 可按 Esc 取消');
      startAILoading();
      aiResult.value = await summarize(aiConfig.value, aiSource.content, aiAbort.signal);
      status.value = ui('Review result · Enter saves a separate note · Esc discards', '查看整理结果 · Enter 另存笔记 · Esc 放弃');
    } else {
      const note = await vault.create(aiSource.relativePath.replace(/\.md$/i, '') + ' - Summary');
      await vault.save(note, aiResult.value + '\n');
      await refreshVault(note.id); mode.value = 'browse'; enterEdit(); status.value = ui('Summary saved separately; original unchanged', '整理结果已另存；原笔记保持不变');
    }
  } catch (error) { status.value = aiAbort?.signal.aborted ? ui('AI request cancelled', 'AI 请求已取消') : `${ui('AI failed', 'AI 请求失败')}: ${errorMessage(error)}`; }
  finally { stopAILoading(); aiBusy.value = false; aiAbort = undefined; }
}
onUnmounted(() => { stopAILoading(); aiAbort?.abort(); });

interface Command {
  label: string;
  title: string;
  run: () => void | Promise<void>;
}

const props = defineProps<{ vaultPath: string; keymap?: Keymap }>();
const vault = new Vault(props.vaultPath);
const moving = shallowRef(false);
const moveSource = shallowRef<string>();
const moveQuery = shallowRef('');
const moveIndex = shallowRef(0);
const moveConfirm = shallowRef(false);
let moveSourceSelection = { query: '', index: 0 };
const moveListRows = computed(() => Math.max(1, bodyHeight.value - 6));
const moveWindowStart = computed(() => Math.max(0, Math.min(moveIndex.value - Math.floor(moveListRows.value / 2), moveChoices.value.length - moveListRows.value)));
const moveDestination = computed(() => {
  const folder = moveChoices.value[moveIndex.value];
  return folder === undefined || moveSource.value === undefined ? '' : `${folder ? folder + '/' : ''}${moveSource.value.split('/').at(-1)}`;
});
const moveChoices = computed(() => {
  const source = moveSource.value;
  const candidates = source === undefined
    ? [...folders.value, ...vaultFiles.value.map(file => file.relativePath)].sort()
    : ['', ...folders.value].filter(folder => folder !== source && !folder.startsWith(source + '/') && folder !== parentFolder(source));
  return candidates.filter(path => (path || '/').toLowerCase().includes(moveQuery.value.toLowerCase()));
});
function enterMove(): void {
  if (!canNavigateAway()) return;
  moveConfirm.value = false;
  moveSource.value = undefined; moveQuery.value = ''; moveIndex.value = 0;
  const selected = selectedSidebarItem.value?.relativePath;
  if (selected) moveIndex.value = Math.max(0, moveChoices.value.indexOf(selected));
  closeSlashMenu(); mode.value = 'move'; status.value = ui('Choose a file or folder to move', '选择要移动的文件或文件夹');
}
async function handleMove(event: TuiInputEvent): Promise<void> {
  if (moveConfirm.value) {
    if (event.type !== 'key') return;
    if (event.key.name === 'escape') { moveConfirm.value = false; return; }
    if (event.key.name !== 'enter' || hasNonShiftModifier(event.key)) return;
  }
  if (event.type === 'text' || event.type === 'paste') { moveQuery.value += event.text; moveIndex.value = 0; return; }
  const key = event.key;
  if (key.name === 'escape') {
    if (moveSource.value !== undefined) { moveSource.value = undefined; moveQuery.value = moveSourceSelection.query; moveIndex.value = moveSourceSelection.index; }
    else { mode.value = 'browse'; status.value = ui('Move cancelled', '已取消移动'); }
    return;
  }
  if (isControlKey(key, 'u')) { moveQuery.value = ''; moveIndex.value = 0; return; }
  if (hasNonShiftModifier(key)) return;
  if (key.name === 'page-up' || key.name === 'page-down') moveIndex.value = clamp(moveIndex.value + (key.name === 'page-up' ? -moveListRows.value : moveListRows.value), 0, Math.max(0, moveChoices.value.length - 1));
  if (key.name === 'home') moveIndex.value = 0;
  if (key.name === 'end') moveIndex.value = Math.max(0, moveChoices.value.length - 1);
  if (key.name === 'backspace') { moveQuery.value = [...moveQuery.value].slice(0, -1).join(''); moveIndex.value = 0; }
  if (key.name === 'up' || key.name === 'down') moveIndex.value = wrapIndex(moveIndex.value, key.name === 'up' ? -1 : 1, moveChoices.value.length);
  if (key.name !== 'enter') return;
  const choice = moveChoices.value[moveIndex.value];
  if (choice === undefined) return;
  if (moveSource.value === undefined) {
    moveSourceSelection = { query: moveQuery.value, index: moveIndex.value };
    moveSource.value = choice; moveIndex.value = 0; moveQuery.value = ''; return;
  }
  if (!moveConfirm.value) { moveConfirm.value = true; return; }
  moving.value = true;
  const source = moveSource.value, name = source.split('/').at(-1)!;
  try {
    const target = await vault.renameEntry(source, choice ? `${choice}/${name}` : name);
    const oldNotePath = activeNote.value?.relativePath;
    const preferred = oldNotePath && (oldNotePath === source || oldNotePath.startsWith(source + '/'))
      ? (target + oldNotePath.slice(source.length)).replace(/\.md$/i, '') : activeNoteId.value;
    await refreshVault(preferred);
    editingNoteId.value = undefined;
    expandAncestors(choice);
    selectTreeItem(folders.value.includes(target) ? `folder:${target}` : `note:${target.replace(/\.md$/i, '')}`);
    mode.value = 'browse'; status.value = `${ui('Moved', '已移动')} → ${target}`;
  } catch (error) { moveConfirm.value = false; status.value = `${ui('Move failed', '移动失败')}: ${errorMessage(error)}`; }
  finally { moving.value = false; }
}
const importDestination = shallowRef('');
const importing = shallowRef(false);
function enterImport(): void {
  importDestination.value = selectedFolderPath();
  promptValue.value = ''; mode.value = 'import'; status.value = ui('Import local file or folder', '导入本地文件或文件夹');
}
async function performImport(): Promise<void> {
  importing.value = true;
  status.value = ui('Copying into vault…', '正在复制到 Vault…');
  try {
    const imported = await importLocal(vault.root, importDestination.value, promptValue.value);
    await refreshVault(activeNoteId.value);
    expandAncestors(importDestination.value);
    mode.value = 'browse';
    if (folders.value.includes(imported)) selectTreeItem(`folder:${imported}`);
    else if (/\.md$/i.test(imported)) selectTreeItem(`note:${imported.replace(/\.md$/i, '')}`);
    status.value = `${ui('Imported', '已导入')} → ${imported}`;
  } catch (error) { status.value = `${ui('Import failed', '导入失败')}: ${errorMessage(error)}`; }
  finally { importing.value = false; }
}
const settings = shallowRef<Settings>({ ...defaultSettings });
const theme = computed(() => themes[settings.value.theme]);
const ui = (english: string, chinese: string) => translate(settings.value.language, english, chinese);
const slashTitle = (command: Parameters<typeof localizedSlashTitle>[1]) => localizedSlashTitle(settings.value.language, command);
const slashDescription = (command: Parameters<typeof localizedSlashDescription>[1]) => localizedSlashDescription(settings.value.language, command);
const settingsReady = shallowRef(false);
const settingIndex = shallowRef(0);
let settingsReturn: AppMode = 'browse';
let writingSettings = false;
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
function openSettings(): void {
  settingsReturn = mode.value === 'edit' ? 'edit' : 'browse';
  closeSlashMenu(); mode.value = 'settings'; status.value = ui('Settings', '设置');
}
async function handleSettingsInput(event: TuiInputEvent): Promise<void> {
  if (event.type !== 'key' || writingSettings) return;
  const key = event.key.name;
  if (key === 'escape') { mode.value = settingsReturn; status.value = ui('Settings closed', '已关闭设置'); return; }
  if (key === 'up' || key === 'down') { settingIndex.value = wrapIndex(settingIndex.value, key === 'up' ? -1 : 1, 4); return; }
  if (!['enter', 'left', 'right'].includes(key ?? '')) return;
  if (settingIndex.value === 3) { openAIConfig(); return; }
  const next = { ...settings.value };
  if (!settingIndex.value) next.autoSave = !next.autoSave;
  else if (settingIndex.value === 1) {
    const keys = Object.keys(themes) as Settings['theme'][];
    next.theme = keys[(keys.indexOf(next.theme) + (key === 'left' ? -1 : 1) + keys.length) % keys.length]!;
  } else {
    const keys = Object.keys(languages) as Settings['language'][];
    next.language = keys[wrapIndex(keys.indexOf(next.language), key === 'left' ? -1 : 1, keys.length)]!;
  }
  writingSettings = true;
  try { await storeSettings(vault.root, next); settings.value = next; status.value = ui('Settings saved', '设置已保存'); }
  catch (error) { status.value = `${ui('Settings failed', '设置保存失败')}: ${errorMessage(error)}`; }
  finally { writingSettings = false; }
}
const { exit } = useApp();
const layout = useLayoutSize();
const shortcutPlatform = keymapPlatform(props.keymap);
const keymapLabel = shortcutPlatform === "darwin" ? "macOS" : shortcutPlatform === "win32" ? "Windows" : "Linux";
const isMacKeymap = shortcutPlatform === "darwin";
const controlKey = (key: string, shift = false) => isMacKeymap
  ? `⌃${shift ? "⇧" : ""}${key}`
  : `Ctrl+${shift ? "Shift+" : ""}${key}`;
const shiftLabel = isMacKeymap ? "⇧" : "Shift";
const actionHint = computed(() => mode.value === 'edit' ? ui(`${escapeLabel} then / commands`, `${escapeLabel} 后按 / 打开命令`) : ui('/ commands', '/ 命令'));
const enterLabel = isMacKeymap ? "↩" : "Enter";
const escapeLabel = isMacKeymap ? "⎋" : "Esc";
const tabLabel = isMacKeymap ? "⇥" : "Tab";

const notes = shallowRef<Note[]>([]);
const folders = shallowRef<string[]>([]);
const vaultFiles = shallowRef<VaultFile[]>([]);
const expandedFolders = shallowRef<Set<string>>(new Set());
const treeInitialized = shallowRef(false);
const loading = shallowRef(true);
const selectedIndex = shallowRef(0);
const activeNoteId = shallowRef<string>();
const focusPane = shallowRef<FocusPane>("sidebar");
const mode = shallowRef<AppMode>("browse");
const mainView = shallowRef<MainView>("preview");
const query = shallowRef("");
const searchFilter = shallowRef("");
const promptValue = shallowRef("");
const commandIndex = shallowRef(0);
const commandReturn = shallowRef<AppMode>('browse');
const commandDock = computed(() => ['browse', 'edit', 'commands'].includes(mode.value));
const commandRows = computed(() => Math.max(1, Math.min(6, Math.floor((viewportHeight.value - 10) / 2))));
const dockHeight = computed(() => commandDock.value ? 3 + (mode.value === 'commands' ? Math.max(1, Math.min(commandRows.value, filteredCommands.value.length)) + 1 : 0) : 0);
const renameTarget = shallowRef<TreeItem>();
const deleteTarget = shallowRef<TreeItem>();
const scrollOffset = shallowRef(0);
const editorScroll = shallowRef(0);
const selectedLinkIndex = shallowRef(0);
const status = shallowRef("Opening vault…");
const statusIsError = computed(() => /failed|error|失败|错误/i.test(status.value));
const editor = shallowRef<EditorState>({ content: "", cursor: 0 });
const editorHorizontalScroll = shallowRef(0);
const findSession = useFindReplace(editor);
const { mode: findMode, target: findTarget, query: findQuery, replacement: replaceValue, matches: findRanges, current: findCurrent } = findSession;
const history = new EditorHistory();
let replayingHistory = false;
watch(editor, (next, previous) => { if (!replayingHistory) history.record(previous, next); }, { flush: "sync" });
const editingNoteId = shallowRef<string>();
const slashStart = shallowRef<number>();
const slashIndex = shallowRef(0);
let slashOriginal: EditorState | undefined;
let slashHistoryCheckpoint: ReturnType<typeof history.checkpoint> | undefined;
const filePickerIndex = shallowRef(0);
const pickerKind = shallowRef<"file" | "image">("file");
const pickingImage = computed(() => mode.value === "pick-file" && pickerKind.value === "image");
const pickerSplit = computed(() => layout.width.value >= 96);
const pickerImageRows = shallowRef<RenderLine[]>([]);
const fileLinkRange = shallowRef<{ start: number; end: number }>();
const pasting = shallowRef(false);
let saveInProgress = false;
let disposed = false;
onUnmounted(() => { disposed = true; });

const sidebarWidth = computed(() => Math.max(24, Math.min(38, Math.floor(layout.width.value * 0.3))));
const showSidebar = computed(() => !['move', 'settings', 'ai-config', 'ai-review'].includes(mode.value) && ((mode.value !== "edit" && !pickingImage.value) || layout.width.value >= 96));
const viewportHeight = computed(() => Number.isFinite(layout.height.value) ? layout.height.value : 24);
const footerHint = computed(() => {
  if (mode.value === 'edit' && findMode.value !== 'closed') return findMode.value === 'find'
    ? ui(`${enterLabel} next · ${shiftLabel}+${enterLabel} previous · ${escapeLabel} close`, `${enterLabel} 下一个 · ${shiftLabel}+${enterLabel} 上一个 · ${escapeLabel} 关闭`)
    : ui(`${tabLabel} field/action · ${enterLabel} run · ${shiftLabel}+${enterLabel} previous · ${escapeLabel} close`, `${tabLabel} 切换字段/操作 · ${enterLabel} 执行 · ${shiftLabel}+${enterLabel} 上一个 · ${escapeLabel} 关闭`);
  if (mode.value === 'commands') return ui(`↑↓ choose · ${tabLabel} complete · ${enterLabel} run · ${escapeLabel} return`, `↑↓ 选择 · ${tabLabel} 补全 · ${enterLabel} 执行 · ${escapeLabel} 返回`);
  if (mode.value === 'settings') return ui(`↑↓ select · ←/→ change · ${enterLabel} apply/open · ${escapeLabel} return`, `↑↓ 选择 · ←/→ 更改 · ${enterLabel} 应用/打开 · ${escapeLabel} 返回`);
  if (mode.value === 'ai-config') return ui(`↑↓ field · type replaces · ${enterLabel} next/save · ${escapeLabel} cancel`, `↑↓ 字段 · 输入替换 · ${enterLabel} 下一项/保存 · ${escapeLabel} 取消`);
  if (mode.value === 'ai-review') return aiBusy.value ? ui(`${escapeLabel} cancel request`, `${escapeLabel} 取消请求`) : ui(`↑↓ scroll · ${enterLabel} ${aiResult.value ? 'save copy' : 'send note'} · ${escapeLabel} cancel`, `↑↓ 滚动 · ${enterLabel} ${aiResult.value ? '保存副本' : '发送笔记'} · ${escapeLabel} 取消`);
  if (mode.value === 'move') return moveConfirm.value ? ui(`${enterLabel} confirm · ${escapeLabel} back`, `${enterLabel} 确认 · ${escapeLabel} 返回`) : ui(`↑↓ select · PgUp/PgDn page · ${enterLabel} next · ${escapeLabel} back`, `↑↓ 选择 · PgUp/PgDn 翻页 · ${enterLabel} 下一步 · ${escapeLabel} 返回`);
  if (mode.value === 'import') return ui(`${enterLabel} import · ${escapeLabel} cancel · ${controlKey('U')} clear`, `${enterLabel} 导入 · ${escapeLabel} 取消 · ${controlKey('U')} 清空`);
  if (mode.value !== "edit") return layout.width.value >= 72
    ? ui('e edit · q quit · / commands · /jot · /summarize · /settings', 'e 编辑 · q 退出 · / 命令 · /jot 随记 · /summarize AI 整理 · /settings 设置')
    : ui('e edit · q quit · / commands', 'e 编辑 · q 退出 · / 命令');
  if (layout.width.value >= 110) {
    return ui(`${controlKey('F/R')} find/replace · ${controlKey('A')} select · ${controlKey('C')} copy · ${controlKey('X')} cut · ${controlKey('V')} paste · /save`, `${controlKey('F/R')} 查找/替换 · ${controlKey('A')} 全选 · ${controlKey('C')} 复制 · ${controlKey('X')} 剪切 · ${controlKey('V')} 粘贴 · /save`);
  }
  if (layout.width.value >= 72) return ui(`${controlKey('F/R')} find/replace · ${controlKey('A/C/X/V')} text · /save`, `${controlKey('F/R')} 查找/替换 · ${controlKey('A/C/X/V')} 文本操作 · /save`);
  return ui(`${controlKey('C')} copy · ${controlKey('V')} paste · ${actionHint.value}`, `${controlKey('C')} 复制 · ${controlKey('V')} 粘贴 · ${actionHint.value}`);
});
const bodyHeight = computed(() => {
  const height = Number.isFinite(layout.height.value) ? layout.height.value : 24;
  return Math.max(3, height - 3 - headerHeight.value - dockHeight.value);
});
const visibleRows = computed(() => Math.max(3, bodyHeight.value - 3));
const displayedNotes = computed(() => vault.search(notes.value, searchFilter.value));
const sidebarItems = computed(() => searchFilter.value
  ? buildSearchTree(displayedNotes.value)
  : buildVaultTree(notes.value, folders.value, expandedFolders.value));
const sidebarWindowStart = computed(() => Math.max(0, selectedIndex.value - visibleRows.value + 2));
const visibleSidebarItems = computed(() => sidebarItems.value.slice(sidebarWindowStart.value, sidebarWindowStart.value + visibleRows.value));
const selectedSidebarItem = computed(() => sidebarItems.value[selectedIndex.value]);
function iconColor(kind: VaultIconKind, selected: boolean): Color {
  if (selected) return theme.value.background;
  if (kind === 'folder') return theme.value.folder;
  if (kind === 'note') return theme.value.note;
  if (kind === 'image') return theme.value.image;
  if (kind === 'root') return theme.value.accent;
  return theme.value.muted;
}
function sidebarItemParts(item: TreeItem, selected: boolean) {
  const disclosure = item.kind === 'folder' ? (item.expanded ? icons.expanded : icons.collapsed) : ' ';
  const lead = `${"  ".repeat(item.depth)}${selected ? `${icons.selected} ` : "  "}${disclosure} `;
  const icon = item.kind === 'folder' ? icons.folder : icons.note;
  const label = ` ${item.label}`;
  const padding = " ".repeat(Math.max(0, sidebarWidth.value - 3 - stringWidth(`${lead}${icon}${label}`)));
  return { item, selected, lead, icon, label: `${label}${padding}` };
}
const visibleSidebarRows = computed(() => visibleSidebarItems.value.map((item, index) =>
  sidebarItemParts(item, sidebarWindowStart.value + index === selectedIndex.value)));
function moveEntryKind(path: string): VaultIconKind {
  if (!path) return 'root';
  return folders.value.includes(path) ? 'folder' : vaultFileKind(path);
}
function moveEntryIcon(path: string): string {
  return icons[moveEntryKind(path)];
}
const selectedPath = computed(() => selectedSidebarItem.value?.relativePath ?? "");
const selectedPathRows = computed(() => selectedPath.value && showSidebar.value
  ? Math.max(1, Math.ceil(stringWidth(`SELECTED · ${selectedPath.value}`) / Math.max(1, layout.width.value - 2)))
  : 0);
const headerHeight = computed(() => 2 + selectedPathRows.value);
const activeNote = computed(() => notes.value.find((note) => note.id === activeNoteId.value));
const activeBacklinks = computed(() => activeNote.value ? vault.backlinks(notes.value, activeNote.value) : []);
const previewContent = computed(() => editingNoteId.value !== undefined && editingNoteId.value === activeNoteId.value
  ? editor.value.content
  : activeNote.value?.content ?? "");
const markdownLines = computed(() => renderMarkdown(previewContent.value));
const imageRows = shallowRef<Map<string, RenderLine[]>>(new Map());
const graphics = inject(KITTY_GRAPHICS, undefined);
const imageCache = new ImagePreviewCache(graphics);
const imageColumns = computed(() => {
  const available = layout.width.value - (showSidebar.value ? sidebarWidth.value : 0) - 4;
  return Math.max(2, Math.floor(mode.value === "edit" ? available / 2 - 3 : available));
});
const previewLines = computed(() => markdownLines.value.flatMap((line) => [
  ...wrapRenderLine(line, imageColumns.value),
  ...line.segments.flatMap((segment) => segment.image ? (imageRows.value.get(segment.image.target) ?? []) : []),
]));
watch([markdownLines, () => activeNote.value?.path, imageColumns], async (_, __, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  const source = activeNote.value?.path;
  const targets = [...new Set(markdownLines.value.flatMap((line) => line.segments.flatMap((segment) => segment.image ? [segment.image.target] : [])))];
  const notice = (text: string): RenderLine[] => [{ kind: "image", indent: 0, segments: [{ text, color: "gray" }] }];
  imageRows.value = new Map(targets.map((target) => [target, notice(ui('Loading image…', '正在加载图片…'))]));
  if (!source) return;
  // Sequential decoding bounds memory use when a note embeds many images.
  for (const target of targets) {
    if (cancelled) return;
    let rows: RenderLine[];
    try { rows = await imageCache.load(target, source, vault.root, imageColumns.value); }
    catch (error) { rows = notice(`${ui('Image unavailable', '图片无法显示')}: ${errorMessage(error)}`); }
    if (cancelled) return;
    const next = new Map(imageRows.value); next.set(target, rows); imageRows.value = next;
  }
}, { immediate: true });
const visiblePreview = computed(() => previewLines.value.slice(scrollOffset.value, scrollOffset.value + visibleRows.value));
const bodyBox = shallowRef<InstanceType<typeof Box> | null>(null);
const mainBox = shallowRef<InstanceType<typeof Box> | null>(null);
const editBox = shallowRef<InstanceType<typeof Box> | null>(null);
const editorPaneBox = shallowRef<InstanceType<typeof Box> | null>(null);
const editorTextBox = shallowRef<InstanceType<typeof Box> | null>(null);
const editorPaneMetrics = useBoxMetrics(editorPaneBox), editorTextMetrics = useBoxMetrics(editorTextBox);
const liveBox = shallowRef<InstanceType<typeof Box> | null>(null);
const readBox = shallowRef<InstanceType<typeof Box> | null>(null);
const pickerBox = shallowRef<InstanceType<typeof Box> | null>(null);
const pickerContentBox = shallowRef<InstanceType<typeof Box> | null>(null);
const pickerPreviewBox = shallowRef<InstanceType<typeof Box> | null>(null);
const pickerImageBox = shallowRef<InstanceType<typeof Box> | null>(null);
const pickerMetrics = useBoxMetrics(pickerBox), pickerContentMetrics = useBoxMetrics(pickerContentBox);
const pickerPreviewMetrics = useBoxMetrics(pickerPreviewBox), pickerImageMetrics = useBoxMetrics(pickerImageBox);
const bodyMetrics = useBoxMetrics(bodyBox), mainMetrics = useBoxMetrics(mainBox);
const editMetrics = useBoxMetrics(editBox), liveMetrics = useBoxMetrics(liveBox), readMetrics = useBoxMetrics(readBox);
watchEffect(() => {
  if (!graphics?.setViewport) return;
  if (pickingImage.value) {
    const chain = [bodyMetrics, mainMetrics, pickerMetrics, pickerContentMetrics, pickerPreviewMetrics, pickerImageMetrics];
    if (!chain.every((box) => box.hasMeasured.value)) { graphics.setViewport([], 0, 0, 0, 0); return; }
    const x = chain.reduce((sum, box) => sum + box.left.value, 0);
    const y = chain.reduce((sum, box) => sum + box.top.value, 0);
    graphics.setViewport(pickerImageRows.value, x, y, Math.floor(pickerImageMetrics.width.value),
      Math.min(Math.floor(pickerImageMetrics.height.value), viewportHeight.value - 2 - y));
    return;
  }
  const editing = mode.value === "edit";
  const shown = editing || (mainView.value === "preview" && !["commands", "pick-file", "settings", "import", "move", "ai-config", "ai-review"].includes(mode.value));
  const chain = editing ? [bodyMetrics, mainMetrics, editMetrics, liveMetrics] : [bodyMetrics, mainMetrics, readMetrics];
  if (!shown || !chain.every((box) => box.hasMeasured.value)) {
    graphics.setViewport([], 0, 0, 0, 0); return;
  }
  const x = chain.reduce((sum, box) => sum + box.left.value, 0) + (editing ? 2 : 0);
  const y = chain.reduce((sum, box) => sum + box.top.value, 0) + 2;
  const width = Math.floor(chain.at(-1)!.width.value - (editing ? 2 : 0));
  graphics.setViewport(visiblePreview.value, x, y, width, Math.min(visibleRows.value, viewportHeight.value - 2 - y));
}, { flush: "post" });
onUnmounted(() => { graphics?.setViewport?.([], 0, 0, 0, 0); });
const editorGutter = computed(() => Math.max(3, String(editor.value.content.split("\n").length).length) + 3);
const editorTextWidth = computed(() => Math.max(1, Math.floor(editorTextMetrics.width.value) - editorGutter.value));
const allEditorLines = computed(() => editorLines(editor.value, editorHorizontalScroll.value, editorTextWidth.value));
const slashQuery = computed(() => {
  if (slashStart.value === undefined || editor.value.cursor <= slashStart.value) return "";
  return editor.value.content.slice(slashStart.value + 1, editor.value.cursor);
});
const slashCommands = computed(() => settings.value.language === 'en' ? filterSlashCommands(slashQuery.value) : filterSlashCommands('').filter(command => {
  const terms = slashQuery.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return terms.every(term => `${command.label} ${command.keywords} ${slashTitle(command)} ${slashDescription(command)}`.toLocaleLowerCase().includes(term));
}));
const slashWindowStart = computed(() => Math.max(0, slashIndex.value - 4));
const visibleSlashCommands = computed(() => slashCommands.value.slice(slashWindowStart.value, slashWindowStart.value + 5));
const slashMenuRows = computed(() => slashStart.value === undefined ? 0 : Math.min(5, slashCommands.value.length) + 2);
const findPanelRows = computed(() => findMode.value === 'closed' ? 0 : findMode.value === 'find' ? 3 : 5);
const editorVisibleRows = computed(() => Math.max(3, visibleRows.value - slashMenuRows.value - findPanelRows.value));
const visibleEditorLines = computed(() => allEditorLines.value.slice(editorScroll.value, editorScroll.value + editorVisibleRows.value));
const editingNote = computed(() => notes.value.find((note) => note.id === editingNoteId.value));
const isDirty = computed(() => Boolean(editingNote.value && editor.value.content !== editingNote.value.content));
watch([() => editor.value.content, isDirty, () => settings.value.autoSave, settingsReady], () => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (settingsReady.value && settings.value.autoSave && isDirty.value) {
    autoSaveTimer = setTimeout(() => { if (!disposed) void saveCurrent(); }, 1000);
  }
});
onUnmounted(() => { if (autoSaveTimer) clearTimeout(autoSaveTimer); });
const activeLinks = computed(() => activeNote.value?.links ?? []);
const mouse = inject(MOUSE_INPUT, undefined);
let dragging = false;
const unsubscribeMouse = mouse?.subscribe(handleEditorMouse);
watchEffect(() => {
  const enabled = mode.value === "edit" && !pasting.value;
  mouse?.setEnabled(enabled);
  if (!enabled) dragging = false;
});
onUnmounted(() => { unsubscribeMouse?.(); mouse?.setEnabled(false); });
watch(editorTextWidth, (width, previous) => {
  if (mode.value !== "edit") return;
  if (width > previous) editorHorizontalScroll.value = Math.max(0, Math.min(editorHorizontalScroll.value, cursorColumn(editor.value) - width + 1));
  ensureEditorCursorVisible();
});

const commands = computed<Command[]>(() => [
  ...([
    ['Quick note', quickNote], ['Organize saved note with AI', openAIReview], ['AI model configuration', openAIConfig],
    ['Move file or folder', enterMove], ['Import local file or folder', enterImport], ['Settings', openSettings],
    ['New note', enterCreate], ['New folder', enterCreateFolder], ['Rename selected', enterRename],
    ['Delete selected file or folder', requestDeleteEntry], ['Edit / preview', enterEdit], ['Search vault', enterSearch],
    ['Reload vault', reload], ['Keyboard help', () => showView('help')], ['Quit', requestQuit],
  ] as const).map(([label, run]) => ({ label, title: commandTitle(settings.value.language, label), run })),
]);
const filteredCommands = computed(() => filterCommands(commands.value, promptValue.value));
const commandStart = computed(() => Math.max(0, commandIndex.value - commandRows.value + 1));
const filteredVaultFiles = computed(() => {
  const terms = promptValue.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return vaultFiles.value.filter((file) => (pickerKind.value !== "image" || isImageFile(file.relativePath))
    && terms.every((term) => file.relativePath.toLocaleLowerCase().includes(term)));
});
const pickerListRows = computed(() => pickingImage.value && !pickerSplit.value
  ? Math.max(2, Math.min(5, Math.floor((visibleRows.value - 5) / 2))) : Math.max(3, visibleRows.value - 3));
const filePickerWindowStart = computed(() => Math.max(0, filePickerIndex.value - pickerListRows.value + 1));
const visibleVaultFiles = computed(() => filteredVaultFiles.value.slice(filePickerWindowStart.value, filePickerWindowStart.value + pickerListRows.value));
const selectedPickerImage = computed(() => pickingImage.value ? filteredVaultFiles.value[filePickerIndex.value] : undefined);
watch([selectedPickerImage, pickerImageMetrics.width, pickerImageMetrics.height], async (_, __, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  const file = selectedPickerImage.value;
  pickerImageRows.value = [];
  if (!file || pickerImageMetrics.width.value < 1 || pickerImageMetrics.height.value < 1) return;
  const notice = (text: string): RenderLine[] => [{ kind: "image", indent: 0, segments: [{ text, color: "gray" }] }];
  pickerImageRows.value = notice(ui('Loading image…', '正在加载图片…'));
  let rows: RenderLine[];
  try {
    rows = await imageCache.load(pathToFileURL(file.path).href, file.path, vault.root,
      pickerImageMetrics.width.value, pickerImageMetrics.height.value);
  } catch (error) { rows = notice(`${ui('Image unavailable', '图片无法显示')}: ${errorMessage(error)}`); }
  if (!cancelled && !disposed) pickerImageRows.value = rows;
});

onMounted(async () => {
  await reload();
  try {
    settings.value = await loadSettings(vault.root);
    if (/^\d+ notes · \d+ folders loaded$/.test(status.value)) {
      status.value = ui(`${notes.value.length} notes · ${folders.value.length} folders loaded`, `已加载 ${notes.value.length} 篇笔记 · ${folders.value.length} 个文件夹`);
    }
  }
  catch (error) { status.value = `${ui('Settings failed', '设置加载失败')}: ${errorMessage(error)}`; }
  settingsReady.value = true;
  try { aiConfig.value = await loadAIConfig(vault.root); }
  catch (error) { status.value = `${ui('AI config failed', 'AI 配置加载失败')}: ${errorMessage(error)}`; }
});

useInput(function handleInput(event) {
  if (mode.value === 'ai-config' || mode.value === 'ai-review') { void handleAI(event); return; }
  if (aiBusy.value) return;
  if (pasting.value || importing.value || moving.value) return;
  if (mode.value === 'move') { void handleMove(event); return; }
  if (mode.value === 'import') { handlePromptInput(event); return; }
  if (mode.value === 'settings') { void handleSettingsInput(event); return; }
  if (mode.value === "confirm-quit") return handleQuitConfirmation(event);
  if (mode.value === "confirm-delete") return handleDeleteConfirmation(event);
  if (mode.value === "edit") return handleEditorInput(event);
  if (["search", "create", "create-folder", "rename", "commands", "pick-file"].includes(mode.value)) return handlePromptInput(event);

  if (event.type === "paste") return;
  if (event.type === "key") {
    const key = event.key;
    if (hasNonShiftModifier(key)) return;
    if (key.name === "tab") {
      focusPane.value = focusPane.value === "sidebar" ? "main" : "sidebar";
      status.value = focusPane.value === "sidebar" ? ui('Navigator focused', '已聚焦文件树') : ui('Note focused', '已聚焦笔记');
      return;
    }
    if (key.name === "escape") {
      if (mainView.value !== "preview") showView("preview");
      else if (searchFilter.value) {
        searchFilter.value = "";
        selectTreeItem(`note:${activeNoteId.value ?? ""}`);
        status.value = ui('Search cleared', '搜索已清空');
      }
      return;
    }
    if (key.name === "up") return moveSelection(-1);
    if (key.name === "down") return moveSelection(1);
    if (key.name === "page-up") return moveSelection(-visibleRows.value);
    if (key.name === "page-down") return moveSelection(visibleRows.value);
    if (key.name === "home") return moveToBoundary(0);
    if (key.name === "end") return moveToBoundary(Number.POSITIVE_INFINITY);
    if (key.name === "left" && focusPane.value === "sidebar") return collapseSelectedFolder();
    if (key.name === "right" && focusPane.value === "sidebar") return expandSelectedFolder();
    if (key.name === "enter") return activateSelection();
    return;
  }

  if (event.type !== "text") return;
  if (event.text === "q") { requestQuit(); return; }
  if (event.text === "e") { enterEdit(); return; }
  if (event.text.startsWith('/')) {
    enterCommands();
    if (event.text.length > 1) handlePromptInput({ ...event, text: event.text.slice(1) });
  }
});

async function reload(): Promise<void> {
  if (isDirty.value) {
    status.value = ui('Save or leave edit mode before reloading', '重新加载前请保存或退出编辑模式');
    return;
  }
  loading.value = true;
  try {
    const currentId = activeNoteId.value;
    await refreshVault(currentId);
    editingNoteId.value = undefined;
    status.value = ui(`${notes.value.length} notes · ${folders.value.length} folders loaded`, `已加载 ${notes.value.length} 篇笔记 · ${folders.value.length} 个文件夹`);
  } catch (error) {
    status.value = `${ui('Vault error', 'Vault 错误')}: ${errorMessage(error)}`;
  } finally {
    loading.value = false;
  }
}

async function refreshVault(preferredNoteId?: string): Promise<void> {
  const [loadedNotes, loadedFolders, loadedFiles] = await Promise.all([vault.loadNotes(), vault.loadFolders(), vault.loadFiles()]);
  notes.value = loadedNotes;
  folders.value = loadedFolders;
  vaultFiles.value = loadedFiles;
  if (!treeInitialized.value) {
    expandedFolders.value = new Set(loadedFolders);
    treeInitialized.value = true;
  } else {
    expandedFolders.value = new Set([...expandedFolders.value].filter((folder) => loadedFolders.includes(folder)));
  }
  activeNoteId.value = loadedNotes.some((note) => note.id === preferredNoteId) ? preferredNoteId : loadedNotes[0]?.id;
  const activeFolder = activeNoteId.value ? parentFolder(`${activeNoteId.value}.md`) : "";
  if (activeFolder) expandAncestors(activeFolder);
  selectTreeItem(`note:${activeNoteId.value ?? ""}`);
}

function moveSelection(delta: number): void {
  if (focusPane.value === "main") {
    const max = mainView.value === "preview"
      ? Math.max(0, previewLines.value.length - visibleRows.value)
      : Math.max(0, activeBacklinks.value.length - visibleRows.value);
    scrollOffset.value = clamp(scrollOffset.value + delta, 0, max);
    return;
  }
  if (!canNavigateAway()) return;
  const last = sidebarItems.value.length - 1;
  selectedIndex.value = Math.abs(delta) === 1 ? wrapIndex(selectedIndex.value, delta, last + 1) : clamp(selectedIndex.value + delta, 0, Math.max(0, last));
  syncActiveFromSelection();
}

function moveToBoundary(value: number): void {
  if (focusPane.value === "sidebar") {
    if (!canNavigateAway()) return;
    selectedIndex.value = value === 0 ? 0 : Math.max(0, sidebarItems.value.length - 1);
    syncActiveFromSelection();
    return;
  }
  scrollOffset.value = value === 0 ? 0 : Math.max(0, previewLines.value.length - visibleRows.value);
}

function activateSelection(): void {
  if (focusPane.value === "sidebar") {
    const item = selectedSidebarItem.value;
    if (item?.kind === "folder") {
      toggleFolder(item.relativePath);
      return;
    }
    if (item?.kind !== "note") {
      status.value = ui('No notes in this vault', '当前 Vault 中没有笔记');
      return;
    }
    if (!canNavigateAway()) return;
    activeNoteId.value = item.note.id;
    resetNoteViewport();
    enterEdit();
    return;
  }
  followSelectedLink();
}

function enterSearch(): void {
  if (!canNavigateAway()) return;
  mode.value = "search";
  query.value = searchFilter.value;
  selectedIndex.value = 0;
  syncActiveFromSelection();
  status.value = ui('Search titles and content', '搜索标题和内容');
}

function enterCreate(): void {
  if (!canNavigateAway()) return;
  mode.value = "create";
  const folder = selectedFolderPath();
  promptValue.value = folder ? `${folder}/` : "";
  status.value = ui('Name the new note (folders are allowed)', '输入新笔记名称（支持文件夹路径）');
}

function enterCreateFolder(): void {
  if (!canNavigateAway()) return;
  mode.value = "create-folder";
  const folder = selectedFolderPath();
  promptValue.value = folder ? `${folder}/` : "";
  status.value = ui('Create folder · use / for nested folders', '新建文件夹 · 使用 / 创建多级目录');
}

function enterRename(): void {
  if (!canNavigateAway()) return;
  const item = selectedSidebarItem.value;
  if (!item || searchFilter.value) {
    status.value = ui('Clear search before renaming a file or folder', '重命名前请先清空搜索');
    return;
  }
  renameTarget.value = item;
  mode.value = "rename";
  promptValue.value = item.label;
  status.value = `${ui('Rename', '重命名')} ${ui(item.kind, item.kind === 'folder' ? '文件夹' : '文件')}: ${item.relativePath}`;
}

function enterCommands(): void {
  if (mode.value !== 'commands') commandReturn.value = mode.value === 'edit' ? 'edit' : 'browse';
  mode.value = "commands";
  promptValue.value = "";
  commandIndex.value = 0;
  status.value = ui('Command palette', '命令面板');
}

function enterEdit(): void {
  const note = activeNote.value;
  if (!note) {
    status.value = ui('Create a note first', '请先创建一篇笔记');
    return;
  }
  mode.value = "edit";
  closeSlashMenu();
  focusPane.value = "main";
  if (editingNoteId.value !== note.id) {
    findSession.close();
    editingNoteId.value = note.id;
    editor.value = { content: note.content, cursor: note.content.length };
    history.clear();
    editorHorizontalScroll.value = 0;
    editorScroll.value = 0;
    scrollOffset.value = 0;
  }
  ensureEditorCursorVisible();
  status.value = ui(`Editing ${note.title} · live preview`, `正在编辑 ${note.title} · 实时预览`);
}

function openFind(mode: 'find' | 'replace'): void {
  findSession.open(mode);
  closeSlashMenu();
  status.value = mode === 'find' ? ui('Find in note', '在笔记中查找') : ui('Find and replace in note', '在笔记中查找替换');
}

function closeFind(): void {
  findSession.close();
  status.value = ui('Find closed', '已关闭查找');
}

function runFind(direction: 1 | -1): void {
  const result = findSession.next(direction);
  status.value = result.total
    ? ui(`Match ${result.current}/${result.total}`, `匹配 ${result.current}/${result.total}`)
    : ui('No matches in this note', '当前笔记中没有匹配内容');
  ensureEditorCursorVisible();
}

function runReplaceCurrent(): void {
  const result = findSession.replaceOne();
  status.value = result.replaced
    ? ui(`Replaced · ${result.total} matches remain`, `已替换 · 还剩 ${result.total} 个匹配`)
    : result.total ? ui('Match selected · run Replace again', '已选择匹配项 · 再次执行“替换当前”') : ui('No matches in this note', '当前笔记中没有匹配内容');
  ensureEditorCursorVisible();
}

function runReplaceAll(): void {
  const result = findSession.replaceEvery();
  status.value = ui(`Replaced ${result.replaced} matches`, `已替换 ${result.replaced} 处匹配`);
  ensureEditorCursorVisible();
}

function handleFindInput(event: TuiInputEvent): void {
  if (event.type === 'key') {
    const key = event.key;
    if (key.name === 'escape') { closeFind(); return; }
    if (key.name === 'tab' && findMode.value === 'replace') {
      findSession.cycleTarget(key.shift ? -1 : 1);
      return;
    }
    if (isControlKey(key, 'u') && (findTarget.value === 'find' || findTarget.value === 'replace')) {
      findSession.clear(); return;
    }
    if (key.name === 'backspace' && (findTarget.value === 'find' || findTarget.value === 'replace')) {
      findSession.backspace(); return;
    }
    if (key.name === 'enter') {
      if (key.shift) runFind(-1);
      else if (findTarget.value === 'one') runReplaceCurrent();
      else if (findTarget.value === 'all') runReplaceAll();
      else runFind(1);
    }
    return;
  }
  if (findTarget.value !== 'find' && findTarget.value !== 'replace') return;
  const value = event.text.replace(/[\r\n\x00-\x1f\x7f]/g, '');
  findSession.update(value);
}

function showView(view: MainView): void {
  mainView.value = view;
  focusPane.value = "main";
  scrollOffset.value = 0;
  status.value = view === 'preview' ? ui('Preview', '预览') : view === 'backlinks' ? ui('Backlinks', '反向链接') : ui('Keyboard help', '键盘帮助');
}

function handlePromptInput(event: TuiInputEvent): void {
  if (event.type === "paste") {
    updatePrompt((mode.value === "search" ? query.value : promptValue.value) + event.text);
    return;
  }
  if (event.type === "text") {
    updatePrompt((mode.value === "search" ? query.value : promptValue.value) + event.text);
    return;
  }
  const key = event.key;
  if (key.name === "escape") {
    if (mode.value === "pick-file") {
      cancelVaultFilePicker();
      return;
    }
    mode.value = mode.value === 'commands' ? commandReturn.value : 'browse';
    renameTarget.value = undefined;
    status.value = ui('Cancelled', '已取消');
    return;
  }
  if (isControlKey(key, "u")) {
    updatePrompt("");
    return;
  }
  if (hasNonShiftModifier(key)) return;
  if (mode.value === 'commands' && key.name === 'tab') {
    const command = filteredCommands.value[commandIndex.value];
    if (command) updatePrompt(commandName(command.label));
    return;
  }
  if (key.name === "backspace") {
    const value = mode.value === "search" ? query.value : promptValue.value;
    updatePrompt([...value].slice(0, -1).join(""));
    return;
  }
  if (mode.value === "search" && (key.name === "up" || key.name === "down")) {
    const last = sidebarItems.value.length - 1;
    selectedIndex.value = wrapIndex(selectedIndex.value, key.name === "up" ? -1 : 1, last + 1);
    syncActiveFromSelection();
    return;
  }
  if (mode.value === "commands" && ['up', 'down', 'page-up', 'page-down', 'home', 'end'].includes(key.name ?? '')) {
    const last = Math.max(0, filteredCommands.value.length - 1);
    const step = key.name === 'page-up' || key.name === 'page-down' ? commandRows.value : 1;
    commandIndex.value = key.name === 'home' ? 0 : key.name === 'end' ? last
      : key.name === 'up' || key.name === 'down' ? wrapIndex(commandIndex.value, key.name === 'up' ? -1 : 1, last + 1)
      : clamp(commandIndex.value + (key.name === 'page-up' ? -step : step), 0, last);
    return;
  }
  if (mode.value === "pick-file" && (key.name === "up" || key.name === "down")) {
    filePickerIndex.value = wrapIndex(filePickerIndex.value, key.name === "up" ? -1 : 1, filteredVaultFiles.value.length);
    return;
  }
  if (key.name !== "enter") return;
  if (mode.value === 'import') { void performImport(); return; }
  if (mode.value === "search") {
    mode.value = "browse";
    if (displayedNotes.value.length) {
      enterEdit();
    } else {
      focusPane.value = "sidebar";
      status.value = ui('No matches', '没有匹配结果');
    }
    return;
  }
  if (mode.value === "create") {
    void createNote();
    return;
  }
  if (mode.value === "create-folder") {
    void createFolder();
    return;
  }
  if (mode.value === "rename") {
    void renameSelected();
    return;
  }
  if (mode.value === "pick-file") {
    insertSelectedVaultFile();
    return;
  }
  const command = filteredCommands.value[commandIndex.value];
  if (!command) { status.value = ui('No matching command · change the filter or Esc to return', '没有匹配命令 · 修改筛选内容或按 Esc 返回'); return; }
  mode.value = commandReturn.value;
  if (command.label === 'Keyboard help') mode.value = 'browse';
  void command.run();
}

function updatePrompt(value: string): void {
  if (mode.value === "search") {
    query.value = value;
    searchFilter.value = value;
    selectedIndex.value = 0;
    syncActiveFromSelection();
  } else {
    promptValue.value = value;
    commandIndex.value = 0;
    filePickerIndex.value = 0;
  }
}

async function createNote(): Promise<void> {
  mode.value = "browse";
  try {
    const note = await vault.create(promptValue.value);
    searchFilter.value = "";
    await refreshVault(note.id);
    status.value = `${ui('Created', '已创建')} ${note.relativePath}`;
    enterEdit();
  } catch (error) {
    status.value = `${ui('Create failed', '创建失败')}: ${errorMessage(error)}`;
  }
}

async function createFolder(): Promise<void> {
  mode.value = "browse";
  try {
    const folder = await vault.createFolder(promptValue.value);
    await refreshVault(activeNoteId.value);
    expandAncestors(folder);
    selectTreeItem(`folder:${folder}`);
    status.value = `${ui('Created folder', '已创建文件夹')} ${folder}`;
  } catch (error) {
    status.value = `${ui('Create folder failed', '创建文件夹失败')}: ${errorMessage(error)}`;
  }
}

async function renameSelected(): Promise<void> {
  mode.value = "browse";
  const target = renameTarget.value;
  renameTarget.value = undefined;
  if (!target) return;
  const parent = parentFolder(target.relativePath);
  const extension = target.kind === "note" && !promptValue.value.toLocaleLowerCase().endsWith(".md") ? ".md" : "";
  const destination = `${parent ? `${parent}/` : ""}${promptValue.value}${extension}`;
  try {
    const expandedDescendants = target.kind === "folder"
      ? [...expandedFolders.value].filter((folder) => folder === target.relativePath || folder.startsWith(`${target.relativePath}/`))
      : [];
    const renamed = await vault.renameEntry(target.relativePath, destination);
    const preferredId = target.kind === "note"
      ? renamed.replace(/\.md$/i, "")
      : activeNoteId.value?.startsWith(`${target.relativePath}/`)
        ? `${renamed}${activeNoteId.value.slice(target.relativePath.length)}`
        : activeNoteId.value;
    await refreshVault(preferredId);
    if (target.kind === "folder") {
      const next = new Set([...expandedFolders.value].filter((folder) => folder !== target.relativePath && !folder.startsWith(`${target.relativePath}/`)));
      for (const folder of expandedDescendants) next.add(`${renamed}${folder.slice(target.relativePath.length)}`);
      expandedFolders.value = next;
      selectTreeItem(`folder:${renamed}`);
    }
    status.value = `${ui('Renamed to', '已重命名为')} ${renamed}`;
  } catch (error) {
    status.value = `${ui('Rename failed', '重命名失败')}: ${errorMessage(error)}`;
  }
}

function handleEditorInput(event: TuiInputEvent): void {
  if (event.type === 'key') {
    const shortcut = resolveEditorShortcut(event.key, shortcutPlatform);
    if (shortcut?.action === 'find' || shortcut?.action === 'replace') { performTextAction(shortcut); return; }
  }
  if (findMode.value !== 'closed') { handleFindInput(event); return; }
  if (event.type === "paste") {
    if (!event.text) { void pasteClipboard(true); return; }
    closeSlashMenu();
    editor.value = insertText(editor.value, event.text);
    ensureEditorCursorVisible();
    return;
  }
  if (event.type === "text") {
    const openingSlash = event.text.startsWith("/") && slashStart.value === undefined;
    const insertionStart = selectionRange(editor.value).start;
    if (openingSlash) { slashOriginal = editor.value; slashHistoryCheckpoint = history.checkpoint(); }
    editor.value = insertText(editor.value, event.text);
    if (openingSlash) {
      slashStart.value = insertionStart;
      slashIndex.value = 0;
      status.value = ui(`Slash menu · type /code · ${enterLabel} insert`, `斜杠菜单 · 输入 /code · ${enterLabel} 插入`);
    } else {
      validateSlashMenu();
    }
    ensureEditorCursorVisible();
    return;
  }
  const key = event.key;
  if (handleTextShortcut(key)) return;
  if (hasNonShiftModifier(key)) return;
  if (slashStart.value !== undefined) {
    if (key.name === "escape") {
      closeSlashMenu();
      status.value = ui('Slash menu closed', '斜杠菜单已关闭');
      return;
    }
    if (key.name === "up" || key.name === "down") {
      slashIndex.value = wrapIndex(slashIndex.value, key.name === "up" ? -1 : 1, slashCommands.value.length);
      return;
    }
    if (key.name === "enter" || key.name === "tab") {
      const command = slashCommands.value[slashIndex.value];
      if (command) {
        if (command.action === "pick-vault-file") {
          enterVaultFilePicker(slashStart.value);
          return;
        }
        if (command.action === "pick-vault-image") {
          enterVaultFilePicker(slashStart.value, "image");
          return;
        }
        if (command.action === "save-note") {
          if (slashOriginal) {
            replayingHistory = true; editor.value = slashOriginal; replayingHistory = false;
            if (slashHistoryCheckpoint) history.restore(slashHistoryCheckpoint);
          }
          closeSlashMenu();
          void saveCurrent();
          return;
        }
        editor.value = applySlashCommand(editor.value, slashStart.value, command);
        closeSlashMenu();
        status.value = `${ui('Inserted', '已插入')} ${slashTitle(command)}`;
        ensureEditorCursorVisible();
        return;
      }
      closeSlashMenu();
    }
  }
  if (key.name === "escape") {
    mode.value = "browse";
    mainView.value = "preview";
    focusPane.value = "sidebar";
    status.value = isDirty.value ? ui('Unsaved changes — use /edit, then /save', '存在未保存更改——使用 /edit 返回编辑，再用 /save 保存') : ui('Preview', '预览');
    return;
  }
  if (key.name === "backspace") {
    editor.value = backspace(editor.value);
    validateSlashMenu();
  }
  else if (key.name === "delete") editor.value = deleteForward(editor.value);
  else if (key.name === "enter") editor.value = insertText(editor.value, "\n");
  else if (key.name === "tab") editor.value = insertText(editor.value, "  ");
  else if (["left", "right", "up", "down", "home", "end"].includes(key.name ?? "")) {
    closeSlashMenu();
    editor.value = moveCursor(editor.value, key.name as "left" | "right" | "up" | "down" | "home" | "end");
  }
  ensureEditorCursorVisible();
}

function handleTextShortcut(key: TuiKey): boolean {
  const shortcut = resolveEditorShortcut(key, shortcutPlatform);
  if (!shortcut) return false;
  performTextAction(shortcut);
  return true;
}

function performTextAction(shortcut: EditorShortcut): void {
  if (shortcut.action === 'find' || shortcut.action === 'replace') { openFind(shortcut.action); return; }
  if (shortcut.action === "copy" || shortcut.action === "cut") { void copySelection(shortcut.action === "cut"); return; }
  if (shortcut.action === "paste") { void pasteClipboard(); return; }
  closeSlashMenu();
  if (shortcut.action === "select-all") editor.value = selectAll(editor.value);
  else if (shortcut.action === "undo" || shortcut.action === "redo") {
    closeSlashMenu(); replayingHistory = true;
    try { editor.value = shortcut.action === "redo" ? history.redo(editor.value) : history.undo(editor.value); }
    finally { replayingHistory = false; }
    status.value = shortcut.action === 'redo' ? ui('Redo', '重做') : ui('Undo', '撤销');
  }
  else if (shortcut.action === "delete-word") editor.value = deleteWord(editor.value, shortcut.direction);
  else if (shortcut.action === "delete-line") {
    const selected = selectedText(editor.value) ? editor.value : moveCursor(editor.value, shortcut.direction === "left" ? "home" : "end", { select: true });
    editor.value = insertText(selected, "");
  }
  else if (shortcut.action === "page") {
    for (let i = 0; i < editorVisibleRows.value; i++) editor.value = moveCursor(editor.value, shortcut.direction, { select: shortcut.select });
  }
  else if (shortcut.action === "move") {
    editor.value = moveCursor(editor.value, shortcut.direction, shortcut);
  }
  ensureEditorCursorVisible();
}

async function copySelection(cut: boolean): Promise<void> {
  const text = selectedText(editor.value);
  if (!text) { status.value = ui('No text selected', '未选择文本'); return; }
  // The same short input lock as image paste prevents a late clipboard write
  // from deleting a different selection. Failure leaves the original text intact.
  pasting.value = true;
  try {
    await writeClipboardText(text);
    if (disposed) return;
    if (cut) { editor.value = insertText(editor.value, ""); closeSlashMenu(); ensureEditorCursorVisible(); }
    status.value = cut ? ui('Selection cut', '已剪切所选文本') : ui('Selection copied', '已复制所选文本');
  } catch (error) { status.value = `${ui('Copy failed', '复制失败')}: ${errorMessage(error)}`; }
  finally { pasting.value = false; }
}

function handleEditorMouse(event: MouseEvent): void {
  if (mode.value !== "edit" || pasting.value) { dragging = false; return; }
  const chain = [bodyMetrics, mainMetrics, editMetrics, editorPaneMetrics, editorTextMetrics];
  if (!chain.every((box) => box.hasMeasured.value)) return;
  const x = chain.reduce((sum, box) => sum + box.left.value, 0);
  const y = chain.reduce((sum, box) => sum + box.top.value, 0);
  const height = Math.min(editorVisibleRows.value, editorTextMetrics.height.value);
  const inside = event.x >= x && event.x < x + editorTextMetrics.width.value && event.y >= y && event.y < y + height;
  if (event.type === "wheel") {
    if (inside) editorScroll.value = clamp(editorScroll.value + event.delta, 0, Math.max(0, allEditorLines.value.length - height));
    return;
  }
  if (event.type === "up") {
    if (dragging) handleEditorMouse({ ...event, type: "move", button: 0 });
    dragging = false; return;
  }
  if (event.button !== 0 || (event.type === "down" && !inside) || (event.type === "move" && !dragging)) return;
  if (event.type === "move") {
    if (event.y < y) editorScroll.value = Math.max(0, editorScroll.value - 1);
    if (event.y >= y + height) editorScroll.value = Math.min(Math.max(0, allEditorLines.value.length - height), editorScroll.value + 1);
  }
  const row = editorScroll.value + clamp(event.y - y, 0, Math.max(0, height - 1));
  const column = editorHorizontalScroll.value + clamp(event.x - x - editorGutter.value, 0, editorTextWidth.value - 1);
  closeSlashMenu();
  editor.value = setCursor(editor.value, cursorAtPoint(editor.value.content, row, column), event.type === "move" || event.shift);
  if (event.type === "down") dragging = true;
  status.value = selectedText(editor.value)
    ? ui(`${selectedText(editor.value).length} selected · ${controlKey('C')} copy · ${controlKey('X')} cut`, `已选择 ${selectedText(editor.value).length} 个字符 · ${controlKey('C')} 复制 · ${controlKey('X')} 剪切`)
    : ui('Editing · drag to select', '编辑中 · 拖动鼠标选择文本');
}

function validateSlashMenu(): void {
  if (slashStart.value === undefined) return;
  if (editor.value.cursor <= slashStart.value || /\s/.test(slashQuery.value)) {
    closeSlashMenu();
    return;
  }
  slashIndex.value = clamp(slashIndex.value, 0, Math.max(0, slashCommands.value.length - 1));
}

function closeSlashMenu(): void {
  slashStart.value = undefined;
  slashIndex.value = 0;
  slashOriginal = undefined;
  slashHistoryCheckpoint = undefined;
}

async function saveCurrent(): Promise<void> {
  const note = editingNote.value;
  if (!note || saveInProgress) return;
  const snapshot = editor.value.content;
  const savingStatus = ui(`Saving ${note.relativePath}…`, `正在保存 ${note.relativePath}…`);
  saveInProgress = true;
  status.value = savingStatus;
  try {
    const saved = await vault.save(note, snapshot);
    notes.value = notes.value.map((item) => item.id === saved.id ? saved : item);
    // Saving is asynchronous: never replace newer typing or a newly pasted image
    // with the older snapshot that just reached disk.
    if (status.value === savingStatus) status.value = editingNoteId.value === saved.id && editor.value.content !== snapshot
      ? ui(`Saved ${saved.relativePath} · newer edits unsaved`, `已保存 ${saved.relativePath} · 后续修改尚未保存`) : ui(`Saved ${saved.relativePath}`, `已保存 ${saved.relativePath}`);
  } catch (error) {
    status.value = `${ui('Save failed', '保存失败')}: ${errorMessage(error)}`;
  } finally {
    saveInProgress = false;
    if (!disposed && settings.value.autoSave && isDirty.value && editor.value.content !== snapshot) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => { if (!disposed) void saveCurrent(); }, 1000);
    }
  }
}

function enterVaultFilePicker(replaceStart?: number, kind: "file" | "image" = "file"): void {
  if (mode.value !== "edit") enterEdit();
  if (mode.value !== "edit" || !activeNote.value) return;
  fileLinkRange.value = replaceStart === undefined ? selectionRange(editor.value) : { start: replaceStart, end: editor.value.cursor };
  pickerKind.value = kind;
  closeSlashMenu();
  mode.value = "pick-file";
  promptValue.value = "";
  filePickerIndex.value = 0;
  status.value = ui(`Select a vault ${kind} · type to filter`, `选择 Vault 中的${kind === 'image' ? '图片' : '文件'} · 输入以筛选`);
  void vault.loadFiles().then((files) => { vaultFiles.value = files; }).catch((error) => { status.value = `${ui('File list failed', '文件列表加载失败')}: ${errorMessage(error)}`; });
}

function insertSelectedVaultFile(): void {
  const file = filteredVaultFiles.value[filePickerIndex.value];
  const note = activeNote.value;
  if (!file || !note) {
    status.value = ui('No matching vault file', '没有匹配的 Vault 文件');
    return;
  }
  let insertion = markdownVaultFileLink(file.relativePath, note.relativePath, pickerKind.value === "image");
  const range = fileLinkRange.value;
  if (pickerKind.value === "image") {
    const start = range?.start ?? editor.value.cursor, end = range?.end ?? editor.value.cursor;
    if (start > 0 && editor.value.content[start - 1] !== "\n") insertion = `\n${insertion}`;
    if (editor.value.content[end] !== "\n") insertion += "\n";
  }
  if (range) {
    editor.value = {
      content: editor.value.content.slice(0, range.start) + insertion + editor.value.content.slice(range.end),
      cursor: range.start + insertion.length,
    };
  } else {
    editor.value = insertText(editor.value, insertion);
  }
  fileLinkRange.value = undefined;
  promptValue.value = "";
  mode.value = "edit";
  ensureEditorCursorVisible();
  status.value = ui(`Inserted ${pickerKind.value}: ${file.relativePath}`, `已插入${pickerKind.value === 'image' ? '图片' : '文件'}：${file.relativePath}`);
}

function cancelVaultFilePicker(): void {
  const range = fileLinkRange.value;
  if (range) editor.value = { content: editor.value.content.slice(0, range.start) + editor.value.content.slice(range.end), cursor: range.start };
  fileLinkRange.value = undefined;
  promptValue.value = "";
  mode.value = "edit";
  status.value = ui('Vault file selection cancelled', '已取消选择 Vault 文件');
}

async function pasteClipboard(imageOnly = false): Promise<void> {
  if (pasting.value) return;
  if (mode.value !== "edit") enterEdit();
  const note = editingNote.value;
  if (!note || mode.value !== "edit") return;
  pasting.value = true;
  status.value = ui('Reading clipboard…', '正在读取剪贴板…');
  try {
    const content = await readClipboard();
    if (disposed) return;
    let insertion: string;
    if ("image" in content) {
      const path = await storeClipboardImage(vault.root, note.path, content.image);
      if (disposed) return;
      insertion = markdownVaultFileLink(path, note.relativePath, true);
      const { start, end } = selectionRange(editor.value);
      if (start > 0 && editor.value.content[start - 1] !== "\n") insertion = `\n${insertion}`;
      if (editor.value.content[end] !== "\n") insertion += "\n";
      status.value = ui(`Pasted image → ${path} · use /save`, `已粘贴图片 → ${path} · 使用 /save 保存`);
    } else {
      if (imageOnly || !content.text) { status.value = ui('No image in clipboard', '剪贴板中没有图片'); return; }
      insertion = content.text;
      status.value = ui('Pasted clipboard text', '已粘贴剪贴板文本');
    }
    editor.value = insertText(editor.value, insertion);
    closeSlashMenu();
    ensureEditorCursorVisible();
  } catch (error) {
    status.value = `${ui('Paste failed', '粘贴失败')}: ${errorMessage(error)}`;
  } finally {
    pasting.value = false;
  }
}

function previewSegmentText(segment: StyledSegment): string {
  return segment.href ? terminalHyperlink(segment.text, segment.href, activeNote.value?.path) : segment.text;
}

function ensureEditorCursorVisible(): void {
  const column = cursorColumn(editor.value);
  const caretWidth = cursorCellWidth(editor.value);
  if (column < editorHorizontalScroll.value) editorHorizontalScroll.value = column;
  else if (column + caretWidth > editorHorizontalScroll.value + editorTextWidth.value) {
    editorHorizontalScroll.value = column + caretWidth - editorTextWidth.value;
  }
  const line = editor.value.content.slice(0, editor.value.cursor).split("\n").length - 1;
  if (line < editorScroll.value) editorScroll.value = line;
  else if (line >= editorScroll.value + editorVisibleRows.value) editorScroll.value = line - editorVisibleRows.value + 1;
  const sourceLineCount = Math.max(1, editor.value.content.split("\n").length);
  const previewLine = Math.floor((line / sourceLineCount) * previewLines.value.length);
  const previewMax = Math.max(0, previewLines.value.length - visibleRows.value);
  scrollOffset.value = clamp(previewLine - Math.floor(visibleRows.value / 3), 0, previewMax);
}

function selectLink(delta: number): void {
  if (!activeLinks.value.length) {
    status.value = ui('This note has no wiki links', '当前笔记没有 Wiki 链接');
    return;
  }
  selectedLinkIndex.value = (selectedLinkIndex.value + delta + activeLinks.value.length) % activeLinks.value.length;
  status.value = `${ui('Link', '链接')} ${selectedLinkIndex.value + 1}/${activeLinks.value.length}: ${activeLinks.value[selectedLinkIndex.value]}`;
}

function followSelectedLink(): void {
  if (!canNavigateAway()) return;
  const target = activeLinks.value[selectedLinkIndex.value];
  if (!target) return;
  const linked = vault.findLinkedNote(notes.value, target);
  if (!linked) {
    status.value = `${ui('Unresolved link', '无法解析链接')}: ${target}`;
    return;
  }
  searchFilter.value = "";
  activeNoteId.value = linked.id;
  expandAncestors(parentFolder(linked.relativePath));
  selectTreeItem(`note:${linked.id}`);
  resetNoteViewport();
  status.value = `${ui('Followed', '已打开')} → ${linked.title}`;
}

function syncActiveFromSelection(): void {
  const item = selectedSidebarItem.value;
  if (item?.kind !== "note") return;
  activeNoteId.value = item.note.id;
  resetNoteViewport();
}

function selectTreeItem(key: string): void {
  const index = sidebarItems.value.findIndex((item) => item.key === key);
  selectedIndex.value = index >= 0 ? index : clamp(selectedIndex.value, 0, Math.max(0, sidebarItems.value.length - 1));
}

function toggleFolder(folder: string): void {
  const next = new Set(expandedFolders.value);
  if (next.has(folder)) next.delete(folder);
  else next.add(folder);
  expandedFolders.value = next;
  selectTreeItem(`folder:${folder}`);
  status.value = `${next.has(folder) ? ui('Expanded', '已展开') : ui('Collapsed', '已折叠')} ${folder}`;
}

function expandSelectedFolder(): void {
  if (searchFilter.value) return;
  const item = selectedSidebarItem.value;
  if (item?.kind !== "folder") return;
  if (!item.expanded) toggleFolder(item.relativePath);
}

function collapseSelectedFolder(): void {
  if (searchFilter.value) return;
  const item = selectedSidebarItem.value;
  if (!item) return;
  if (item.kind === "folder" && item.expanded) {
    toggleFolder(item.relativePath);
    return;
  }
  const parent = parentFolder(item.relativePath);
  if (parent) selectTreeItem(`folder:${parent}`);
}

function expandAncestors(folder: string): void {
  if (!folder) return;
  const next = new Set(expandedFolders.value);
  const parts = folder.split("/");
  for (let index = 1; index <= parts.length; index++) next.add(parts.slice(0, index).join("/"));
  expandedFolders.value = next;
}

function selectedFolderPath(): string {
  if (searchFilter.value) return activeNote.value ? parentFolder(activeNote.value.relativePath) : "";
  const item = selectedSidebarItem.value;
  if (item?.kind === "folder") return item.relativePath;
  if (item?.kind === "note") return parentFolder(item.relativePath);
  return "";
}

function requestDeleteEntry(): void {
  if (!canNavigateAway()) return;
  const item = selectedSidebarItem.value;
  if (!item) {
    status.value = ui('Select a file or folder first', '请先选择文件或文件夹');
    return;
  }
  deleteTarget.value = item;
  mode.value = "confirm-delete";
  status.value = item.kind === 'folder'
    ? ui(`Permanently delete folder ${item.relativePath} and all contents? y/N`, `永久删除文件夹 ${item.relativePath} 及其全部内容？y/N`)
    : ui(`Permanently delete file ${item.relativePath}? y/N`, `永久删除文件 ${item.relativePath}？y/N`);
}

function handleDeleteConfirmation(event: TuiInputEvent): void {
  if (event.type === "text" && event.text.toLocaleLowerCase() === "y") {
    void deleteConfirmedEntry();
  } else if ((event.type === "text" && event.text.toLocaleLowerCase() === "n") || (event.type === "key" && event.key.name === "escape")) {
    deleteTarget.value = undefined;
    mode.value = "browse";
    status.value = ui('Delete cancelled', '已取消删除');
  }
}

async function deleteConfirmedEntry(): Promise<void> {
  const target = deleteTarget.value;
  deleteTarget.value = undefined;
  mode.value = "browse";
  if (!target) return;
  try {
    await vault.deleteEntry(target.relativePath, target.kind);
    const editingPath = editingNote.value?.relativePath;
    if (editingPath === target.relativePath || (target.kind === "folder" && editingPath?.startsWith(`${target.relativePath}/`))) {
      editingNoteId.value = undefined; editor.value = { content: "", cursor: 0 }; history.clear();
    }
    await refreshVault();
    status.value = ui(`Deleted ${target.kind} ${target.relativePath}`, `已删除${target.kind === 'folder' ? '文件夹' : '文件'} ${target.relativePath}`);
  } catch (error) {
    status.value = `${ui('Delete failed', '删除失败')}: ${errorMessage(error)}`;
  }
}

function canNavigateAway(): boolean {
  if (!isDirty.value) return true;
  status.value = ui('Unsaved changes — use /edit to resume, then /save', '存在未保存更改——使用 /edit 返回编辑，再用 /save 保存');
  return false;
}

function resetNoteViewport(): void {
  scrollOffset.value = 0;
  selectedLinkIndex.value = 0;
  mainView.value = "preview";
}

function requestQuit(): void {
  if (isDirty.value) {
    mode.value = "confirm-quit";
    status.value = ui('Unsaved changes. Quit anyway? y/N', '存在未保存更改，仍要退出吗？y/N');
  } else {
    exit();
  }
}

function handleQuitConfirmation(event: TuiInputEvent): void {
  if (event.type === "text" && event.text.toLocaleLowerCase() === "y") exit();
  else if ((event.type === "text" && event.text.toLocaleLowerCase() === "n") || (event.type === "key" && event.key.name === "escape")) {
    mode.value = "browse";
    status.value = ui('Quit cancelled', '已取消退出');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapIndex(value: number, delta: number, length: number): number {
  return length > 0 ? (value + delta + length) % length : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
</script>

<template>
  <Box
    flexDirection="column"
    :height="viewportHeight"
    :backgroundColor="theme.background"
  >
    <Box
      :height="headerHeight"
      :flexShrink="0"
      :paddingX="1"
      flexDirection="column"
      :borderTop="false"
      :borderLeft="false"
      :borderRight="false"
      borderBottom
      borderStyle="single"
      :borderColor="theme.border"
    >
      <Box :height="1" :flexShrink="0" alignItems="center">
        <Text bold color="#9ee493">◆ LATTICE</Text>
        <Text :color="theme.muted"> · {{ vault.root }}</Text>
        <Box :flexGrow="1" />
        <Text :color="isDirty ? 'yellow' : theme.muted">{{ isDirty ? ui('● modified', '● 已修改') : ui(`${notes.length} notes`, `${notes.length} 篇笔记`) }}</Text>
      </Box>
      <Text v-if="selectedPath && showSidebar" :color="theme.accent" wrap="wrap">{{ ui('SELECTED', '已选择') }} · {{ selectedPath }}</Text>
    </Box>

    <Box ref="bodyBox" :flexGrow="1" :flexShrink="1">
      <Box
        v-if="showSidebar"
        :width="sidebarWidth"
        :flexShrink="0"
        flexDirection="column"
        :paddingX="1"
        :borderTop="false"
        :borderBottom="false"
        :borderLeft="false"
        borderRight
        borderStyle="single"
        :borderColor="focusPane === 'sidebar' ? '#9ee493' : theme.border"
      >
        <Box :height="2" :flexShrink="0" alignItems="center">
          <Text bold :color="focusPane === 'sidebar' ? '#9ee493' : theme.muted">
            {{ searchFilter ? ui(`SEARCH · ${displayedNotes.length}`, `搜索 · ${displayedNotes.length}`) : `VAULT · ${folders.length}` }}
          </Text>
        </Box>
        <Box v-if="loading" :paddingTop="1" flexDirection="column">
          <Text bold :color="theme.accent">◆ {{ ui('OPENING VAULT', '正在打开 VAULT') }}</Text>
          <Text :color="theme.muted">{{ ui('Reading notes…', '正在读取笔记…') }}</Text>
        </Box>
        <Box v-else-if="!sidebarItems.length" :paddingTop="1" flexDirection="column">
          <Text :color="theme.muted">{{ ui('Nothing found.', '没有找到内容。') }}</Text>
          <Text dimColor>/new {{ ui('note', '笔记') }} · /folder {{ ui('directory', '文件夹') }}</Text>
        </Box>
        <Box v-else flexDirection="column">
          <Box
            v-for="(row, index) in visibleSidebarRows"
            :key="row.item.key"
            :height="1"
            :flexShrink="0"
            :backgroundColor="sidebarWindowStart + index === selectedIndex ? theme.accent : undefined"
          >
            <Text
              :color="row.selected ? theme.background : theme.foreground"
              :bold="row.selected"
              wrap="truncate"
            >{{ row.lead }}<Text :color="iconColor(row.item.kind, row.selected)" bold>{{ row.icon }}</Text>{{ row.label }}</Text>
          </Box>
        </Box>
      </Box>

      <Box ref="mainBox" :flexGrow="1" :flexShrink="1" flexDirection="column" :paddingX="2">
        <Box v-if="mode === 'ai-config'" flexDirection="column" :flexGrow="1" :paddingTop="1" overflow="hidden">
          <Box :height="1" :flexShrink="0" alignItems="center">
            <Text bold :color="theme.accent">◆ {{ ui('AI MODEL CONFIGURATION', 'AI 模型配置') }}</Text>
            <Box :flexGrow="1" />
            <Text :color="theme.muted">{{ aiField + 1 }} / {{ aiFields.length }}</Text>
          </Box>
          <Text :color="theme.muted">{{ ui('Configure the provider used by /summarize', '配置 /summarize 使用的模型服务') }}</Text>
          <Text v-if="bodyHeight >= 13"> </Text>
          <Box v-for="(field, index) in aiFields" :key="field" :height="bodyHeight >= 13 ? 2 : 1" :flexShrink="0" flexDirection="column">
            <Text
              :bold="aiField === index"
              :color="aiField === index ? theme.background : theme.foreground"
              :backgroundColor="aiField === index ? theme.accent : theme.background"
              wrap="truncate"
            >{{ aiField === index ? ' › ' : '   ' }}{{ aiLabels[index] }} · {{ aiFieldValue(field) }}{{ aiField === index ? ' ▏' : '' }}</Text>
            <Text v-if="bodyHeight >= 13" :color="aiField === index ? theme.foreground : theme.muted" wrap="truncate">   {{ aiField === index ? aiHelp[index] : '' }}</Text>
          </Box>
          <Box :flexGrow="1" />
          <Text :color="theme.muted" wrap="truncate">{{ ui('Stored privately in this vault · Local endpoints may leave API key empty', '配置仅保存在当前 Vault · 本地服务可不填写 API 密钥') }}</Text>
        </Box>
        <Box v-else-if="mode === 'ai-review'" flexDirection="column" :flexGrow="1" overflow="hidden">
          <Box :height="1" :flexShrink="0" alignItems="center">
            <Text bold :color="theme.accent">◆ {{ aiResult ? ui('REVIEW ORGANIZED NOTE', '查看 AI 整理结果') : ui('ORGANIZE WITH AI', '使用 AI 整理') }}</Text>
            <Box :flexGrow="1" />
            <Text :color="theme.muted">{{ aiConfig.provider }} · {{ aiConfig.model }}</Text>
          </Box>
          <Box v-if="!aiResult && aiBusy" :flexGrow="1" flexDirection="column" alignItems="center">
            <Box :flexGrow="1" />
            <Text bold :color="theme.accent">◆ LATTICE · {{ ui('SYNTHESIS', '整理中') }}</Text>
            <Text :color="theme.foreground" wrap="truncate">{{ aiSource?.relativePath }}</Text>
            <Text> </Text>
            <Text bold :color="theme.accent">{{ aiLoadingFrame }}</Text>
            <Text :color="theme.foreground">{{ aiLoadingMessage }}</Text>
            <Text :color="theme.muted">{{ ui('Waiting for the model', '正在等待模型响应') }} · {{ escapeLabel }} {{ ui('cancels safely', '安全取消') }}</Text>
            <Box :flexGrow="1" />
          </Box>
          <Box v-else-if="!aiResult" :paddingTop="1" flexDirection="column">
            <Text bold :color="theme.foreground" wrap="truncate">{{ aiSource?.relativePath }}</Text>
            <Text :color="theme.muted" wrap="truncate">{{ aiConfig.baseURL }}</Text>
            <Text> </Text>
            <Text :color="theme.foreground">{{ ui('Ready to organize this saved note.', '已准备整理这篇已保存的笔记。') }}</Text>
            <Text :color="theme.muted">{{ ui('Only this note is sent; other notes and images stay local.', '只发送当前笔记；其他笔记和图片保留在本地。') }}</Text>
            <Text :color="theme.muted">{{ ui('Provider charges may apply.', '模型服务商可能收取费用。') }} {{ enterLabel }} {{ ui('send', '发送') }} · {{ escapeLabel }} {{ ui('cancel', '取消') }}</Text>
          </Box>
          <Box v-else flexDirection="column" :flexGrow="1" overflow="hidden">
            <Text :color="theme.muted" wrap="truncate">{{ aiSource?.relativePath }} · {{ ui(`${enterLabel} saves a separate file; original stays unchanged`, `${enterLabel} 另存为新文件；原文件保持不变`) }}</Text>
            <Text> </Text>
            <Text v-for="(line, index) in aiLines.slice(aiScroll, aiScroll + Math.max(1, bodyHeight - 5))" :key="index" :color="theme.foreground" wrap="truncate">{{ line || ' ' }}</Text>
          </Box>
        </Box>
        <Box v-else-if="mode === 'move'" flexDirection="column" :flexGrow="1" overflow="hidden">
          <Box :height="1" :flexShrink="0"><Text bold :color="theme.accent">{{ ui('MOVE', '移动') }} · {{ moveConfirm ? ui('3/3 Confirm move', '3/3 确认移动') : moveSource === undefined ? ui('1/3 Choose source', '1/3 选择来源') : ui('2/3 Choose destination folder', '2/3 选择目标文件夹') }}</Text></Box>
          <Box :height="1" :flexShrink="0"><Text :color="theme.foreground" wrap="truncate">{{ moveSource === undefined ? ui('Choose the file or folder to move', '选择要移动的文件或文件夹') : `${ui('Source', '来源')}: ${moveSource}` }}</Text></Box>
          <Box :height="1" :flexShrink="0"><Text :color="theme.muted" wrap="truncate">{{ moveSource === undefined ? ui('Type to search all vault files and folders', '输入内容以搜索 Vault 中的文件和文件夹') : `${ui('Destination', '目标')}: ${moveDestination}` }}</Text></Box>
          <Box v-if="!moveConfirm" flexDirection="column" :flexGrow="1" overflow="hidden">
            <Box :height="1" :flexShrink="0"><Text :color="theme.accent" wrap="truncate">{{ ui('Search', '搜索') }}: {{ moveQuery }}▏</Text></Box>
            <Box :height="1" :flexShrink="0"><Text :color="theme.muted">{{ moveChoices.length ? moveIndex + 1 : 0 }} / {{ moveChoices.length }} · ↑↓ {{ ui('select', '选择') }} · PgUp/PgDn {{ ui('page', '翻页') }}</Text></Box>
            <Text v-if="!moveChoices.length" :color="theme.muted">{{ ui('No matching paths — clear the search to see available folders.', '没有匹配路径——清空搜索可查看所有文件夹。') }}</Text>
            <Box v-for="(path, index) in moveChoices.slice(moveWindowStart, moveWindowStart + moveListRows)" :key="path" :height="1" :flexShrink="0">
              <Text :color="moveWindowStart + index === moveIndex ? theme.background : theme.foreground"
                :backgroundColor="moveWindowStart + index === moveIndex ? theme.accent : theme.background" wrap="truncate">{{ moveWindowStart + index === moveIndex ? `${icons.selected} ` : '  ' }}<Text :color="iconColor(moveEntryKind(path), moveWindowStart + index === moveIndex)" bold>{{ moveEntryIcon(path) }}</Text> {{ path || ui('/ (Vault root)', '/（Vault 根目录）') }}</Text>
            </Box>
          </Box>
          <Text v-else :color="theme.accent">{{ enterLabel }} {{ ui('confirm move', '确认移动') }} · {{ escapeLabel }} {{ ui('choose another destination', '重新选择目标') }}</Text>
        </Box>
        <Box v-else-if="mode === 'import'" flexDirection="column" :paddingTop="1">
          <Text bold :color="theme.accent">{{ ui('IMPORT LOCAL FILE OR FOLDER', '导入本地文件或文件夹') }}</Text>
          <Text :color="theme.foreground">{{ ui('Destination', '目标') }}: {{ importDestination || '/' }} {{ ui('(current vault)', '（当前 Vault）') }}</Text>
          <Text> </Text>
          <Text :color="theme.foreground">{{ ui('Type or paste a local file or folder path below.', '在下方输入或粘贴本地文件或文件夹路径。') }}</Text>
          <Text :color="theme.muted">{{ ui('Selected folder = destination; selected note = its parent folder.', '选中文件夹时导入其中；选中笔记时导入其父文件夹。') }}</Text>
          <Text :color="theme.muted">{{ ui('Use one path at a time. /import opens this screen from the Vault.', '每次导入一个路径；在 Vault 中使用 /import 打开此页面。') }}</Text>
          <Text :color="theme.muted">{{ enterLabel }} {{ ui('copy', '复制') }} · {{ escapeLabel }} {{ ui('cancel', '取消') }} · {{ controlKey('U') }} {{ ui('clear path', '清空路径') }}</Text>
          <Text :color="theme.muted">{{ ui('Folders are copied recursively. Existing names receive a numeric suffix.', '文件夹会递归复制；同名项目会自动添加数字后缀。') }}</Text>
          <Text :color="theme.muted">{{ ui('The original stays in place. Symbolic links are not imported.', '原文件保持不变；不会导入符号链接。') }}</Text>
          <Text :color="statusIsError ? 'red' : theme.muted">{{ status }}</Text>
        </Box>
        <Box v-else-if="mode === 'settings'" flexDirection="column" :flexGrow="1" :paddingTop="1" overflow="hidden">
          <Box :height="1" :flexShrink="0" alignItems="center">
            <Text bold :color="theme.accent">◆ {{ ui('SETTINGS', '设置') }}</Text>
            <Box :flexGrow="1" />
            <Text :color="theme.muted">VAULT</Text>
          </Box>
          <Text :color="theme.muted">{{ ui('Personalize this vault; changes are saved immediately', '个性化当前 Vault；更改会立即保存') }}</Text>
          <Text> </Text>
          <Box :height="bodyHeight >= 13 ? 3 : 2" :flexShrink="0" flexDirection="column">
            <Text :bold="settingIndex === 0" :color="settingIndex === 0 ? theme.background : theme.foreground" :backgroundColor="settingIndex === 0 ? theme.accent : theme.background" wrap="truncate">{{ settingIndex === 0 ? ' › ' : '   ' }}{{ ui('AUTO SAVE', '自动保存') }} · {{ settings.autoSave ? ui('[ ON ]', '[ 开启 ]') : ui('[ OFF ]', '[ 关闭 ]') }}</Text>
            <Text :color="theme.muted">   {{ ui('Save one second after typing stops', '停止输入一秒后自动保存') }}</Text>
          </Box>
          <Box :height="bodyHeight >= 13 ? 3 : 2" :flexShrink="0" flexDirection="column">
            <Text :bold="settingIndex === 1" :color="settingIndex === 1 ? theme.background : theme.foreground" :backgroundColor="settingIndex === 1 ? theme.accent : theme.background" wrap="truncate">{{ settingIndex === 1 ? ' › ' : '   ' }}{{ ui('THEME', '主题') }} · {{ theme.name }}</Text>
            <Text :color="theme.muted">   Lattice · Nord · Dracula · Paper</Text>
          </Box>
          <Box :height="bodyHeight >= 13 ? 3 : 2" :flexShrink="0" flexDirection="column">
            <Text :bold="settingIndex === 2" :color="settingIndex === 2 ? theme.background : theme.foreground" :backgroundColor="settingIndex === 2 ? theme.accent : theme.background" wrap="truncate">{{ settingIndex === 2 ? ' › ' : '   ' }}{{ ui('LANGUAGE', '语言') }} · {{ languages[settings.language] }}</Text>
            <Text :color="theme.muted">   {{ ui('English · 简体中文', '简体中文 · English') }}</Text>
          </Box>
          <Box :height="bodyHeight >= 13 ? 3 : 2" :flexShrink="0" flexDirection="column">
            <Text :bold="settingIndex === 3" :color="settingIndex === 3 ? theme.background : theme.foreground" :backgroundColor="settingIndex === 3 ? theme.accent : theme.background" wrap="truncate">{{ settingIndex === 3 ? ' › ' : '   ' }}{{ ui('AI MODEL', 'AI 模型') }} · {{ aiConfig.provider }} · {{ aiConfig.model }}</Text>
            <Text :color="theme.muted">   {{ ui(`${enterLabel} opens provider configuration`, `${enterLabel} 打开模型配置`) }}</Text>
          </Box>
          <Box :flexGrow="1" />
          <Text :color="theme.muted">{{ ui('Settings are stored privately in this vault', '设置仅保存在当前 Vault 中') }}</Text>
        </Box>
        <Box v-else-if="mode === 'pick-file'" ref="pickerBox" flexDirection="column" :paddingTop="1" :flexGrow="1" :flexShrink="1" overflow="hidden">
          <Box alignItems="center" :height="1" :flexShrink="0">
            <Text bold color="#9ee493">{{ pickerKind === "image" ? ui('VAULT IMAGES', 'VAULT 图片') : ui('VAULT FILES', 'VAULT 文件') }}</Text>
            <Box :flexGrow="1" />
            <Text :color="theme.muted">{{ filteredVaultFiles.length }}/{{ vaultFiles.length }}</Text>
          </Box>
          <Box :height="1" :flexShrink="0"><Text :color="theme.muted" wrap="truncate">{{ ui('Type to filter', '输入以筛选') }} · ↑/↓ {{ pickingImage ? ui('preview', '预览') : ui('choose', '选择') }} · {{ enterLabel }} {{ ui('insert', '插入') }} · {{ escapeLabel }} {{ ui('cancel', '取消') }}</Text></Box>
          <Box :height="1" :flexShrink="0"><Text color="cyan" wrap="truncate">〉{{ promptValue }}<Text inverse> </Text></Text></Box>
          <Box ref="pickerContentBox" :flexDirection="pickingImage && pickerSplit ? 'row' : 'column'" :flexGrow="1" :flexShrink="1" overflow="hidden">
            <Box flexDirection="column" :width="pickingImage && pickerSplit ? '42%' : '100%'" :height="pickingImage && !pickerSplit ? pickerListRows : undefined" :flexShrink="0" overflow="hidden">
              <Text v-if="!filteredVaultFiles.length" :color="theme.muted" wrap="truncate">{{ pickingImage ? ui('No images found in this vault.', '当前 Vault 中没有图片。') : ui('No matching files inside this vault.', '当前 Vault 中没有匹配文件。') }}</Text>
              <Text
                v-for="(file, index) in visibleVaultFiles"
                v-else
                :key="file.relativePath"
                :color="filePickerWindowStart + index === filePickerIndex ? theme.background : theme.foreground"
                :backgroundColor="filePickerWindowStart + index === filePickerIndex ? theme.accent : theme.background"
                wrap="truncate"
              >{{ filePickerWindowStart + index === filePickerIndex ? `${icons.selected} ` : "  " }}<Text :color="iconColor(vaultFileKind(file.relativePath), filePickerWindowStart + index === filePickerIndex)" bold>{{ icons[vaultFileKind(file.relativePath)] }}</Text> {{ file.relativePath }}</Text>
            </Box>
            <Box v-if="pickingImage" ref="pickerPreviewBox" flexDirection="column" :flexGrow="1" :flexShrink="1" :flexBasis="0" :paddingLeft="pickerSplit ? 2 : 0" :paddingTop="pickerSplit ? 0 : 1" overflow="hidden">
              <Box :height="1" :flexShrink="0"><Text bold :color="theme.accent" wrap="truncate">{{ ui('IMAGE PREVIEW', '图片预览') }} · {{ graphics?.label ?? ui('thumbnail', '缩略图') }}</Text></Box>
              <Box :height="1" :flexShrink="0"><Text :color="theme.muted" wrap="truncate">{{ selectedPickerImage?.relativePath ?? ui('No image selected', '未选择图片') }}</Text></Box>
              <Box ref="pickerImageBox" flexDirection="column" :flexGrow="1" :flexShrink="1" overflow="hidden">
                <Box v-for="(line, index) in pickerImageRows" :key="index" :height="1" :flexShrink="0">
                  <Text wrap="truncate"><Text v-for="(segment, part) in line.segments" :key="part" :color="segment.color" :backgroundColor="segment.backgroundColor">{{ segment.text }}</Text></Text>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        <Box v-else-if="mode === 'edit' || (mode === 'commands' && commandReturn === 'edit')" ref="editBox" :flexGrow="1" :flexShrink="1">
          <Box
            ref="editorPaneBox"
            :flexBasis="0"
            :flexGrow="1"
            :flexShrink="1"
            flexDirection="column"
            :paddingRight="1"
            :borderTop="false"
            :borderBottom="false"
            :borderLeft="false"
            borderRight
            borderStyle="single"
            :borderColor="theme.border"
          >
            <Box :height="2" :flexShrink="0" alignItems="center">
              <Text bold color="#f7c873">{{ ui('EDIT', '编辑') }} · {{ activeNote?.title }}</Text>
              <Box :flexGrow="1" />
              <Text :color="theme.muted">{{ ui('Ln', '行') }} {{ editor.content.slice(0, editor.cursor).split("\n").length }}</Text>
            </Box>
            <Box ref="editorTextBox" flexDirection="column" :height="editorVisibleRows" :flexShrink="0" overflow="hidden">
              <Box v-for="(line, index) in visibleEditorLines" :key="editorScroll + index" :height="1" :flexShrink="0">
                <Text wrap="truncate"><Text :color="theme.border">{{ String(editorScroll + index + 1).padStart(editorGutter - 3, " ") }} │ </Text><Text
                  v-for="(cell, part) in line.cells"
                  :key="part"
                  :backgroundColor="cell.cursor || cell.selected ? theme.accent : undefined"
                  :color="cell.cursor || cell.selected ? theme.background : theme.foreground"
                >{{ cell.text }}</Text></Text>
              </Box>
            </Box>
            <Box
              v-if="findMode !== 'closed'"
              flexDirection="column"
              :marginTop="1"
              :paddingX="1"
              borderTop
              :borderBottom="false"
              :borderLeft="false"
              :borderRight="false"
              borderStyle="single"
              :borderColor="theme.accent"
            >
              <Box :height="1" :flexShrink="0" alignItems="center">
                <Text bold :color="theme.accent">⌕ {{ findMode === 'find' ? ui('FIND', '查找') : ui('FIND & REPLACE', '查找与替换') }}</Text>
                <Box :flexGrow="1" />
                <Text :color="theme.muted">{{ findCurrent }} / {{ findRanges.length }}</Text>
              </Box>
              <Text :bold="findTarget === 'find'" :color="findTarget === 'find' ? theme.background : theme.foreground" :backgroundColor="findTarget === 'find' ? theme.accent : theme.background" wrap="truncate">{{ findTarget === 'find' ? ' › ' : '   ' }}{{ ui('Find', '查找') }} · {{ findQuery }}{{ findTarget === 'find' ? '▏' : '' }}</Text>
              <template v-if="findMode === 'replace'">
                <Text :bold="findTarget === 'replace'" :color="findTarget === 'replace' ? theme.background : theme.foreground" :backgroundColor="findTarget === 'replace' ? theme.accent : theme.background" wrap="truncate">{{ findTarget === 'replace' ? ' › ' : '   ' }}{{ ui('Replace', '替换为') }} · {{ replaceValue }}{{ findTarget === 'replace' ? '▏' : '' }}</Text>
                <Box :height="1" :flexShrink="0">
                  <Text :bold="findTarget === 'one'" :color="findTarget === 'one' ? theme.background : theme.foreground" :backgroundColor="findTarget === 'one' ? theme.accent : theme.background">{{ findTarget === 'one' ? ' › ' : '   ' }}[ {{ ui('Current', '当前') }} ]</Text>
                  <Text>  </Text>
                  <Text :bold="findTarget === 'all'" :color="findTarget === 'all' ? theme.background : theme.foreground" :backgroundColor="findTarget === 'all' ? theme.accent : theme.background">{{ findTarget === 'all' ? ' › ' : '   ' }}[ {{ ui('All', '全部') }} ]</Text>
                </Box>
              </template>
            </Box>
            <Box
              v-if="slashStart !== undefined"
              flexDirection="column"
              :marginTop="1"
              :paddingX="1"
              :borderTop="true"
              :borderBottom="false"
              :borderLeft="false"
              :borderRight="false"
              borderStyle="single"
              :borderColor="theme.border"
            >
              <Text bold color="#9ee493">/ {{ ui('QUICK INSERT', '快速插入') }} <Text :color="theme.muted">{{ slashQuery || ui('all blocks', '全部内容块') }}</Text></Text>
              <Text v-if="!slashCommands.length" :color="theme.muted">{{ ui('No matching block', '没有匹配的内容块') }} · {{ escapeLabel }} {{ ui('closes', '关闭') }}</Text>
              <template v-else>
                <Box
                  v-for="(command, index) in visibleSlashCommands"
                  :key="command.id"
                  :height="1"
                  :flexShrink="0"
                  :backgroundColor="slashWindowStart + index === slashIndex ? theme.accent : undefined"
                >
                  <Text
                    :color="slashWindowStart + index === slashIndex ? theme.background : theme.foreground"
                    wrap="truncate"
                  >{{ slashWindowStart + index === slashIndex ? "› " : "  " }}{{ slashTitle(command) }} · {{ slashDescription(command) }}</Text>
                </Box>
              </template>
            </Box>
          </Box>

          <Box ref="liveBox" :flexBasis="0" :flexGrow="1" :flexShrink="1" flexDirection="column" :paddingLeft="2">
            <Box :height="2" :flexShrink="0" alignItems="center">
              <Text bold :color="theme.accent">{{ ui('LIVE PREVIEW', '实时预览') }} · {{ graphics?.label ?? ui('thumbnail', '缩略图') }}</Text>
              <Box :flexGrow="1" />
              <Text :color="isDirty ? 'yellow' : theme.muted">{{ isDirty ? ui('unsaved', '未保存') : ui('saved', '已保存') }}</Text>
            </Box>
            <Text v-for="(line, index) in visiblePreview" :key="scrollOffset + index" :color="theme.foreground" wrap="truncate">
              <Text :backgroundColor="line.backgroundColor">{{ "  ".repeat(line.indent) }}</Text><Text
                v-for="(segment, segmentIndex) in line.segments"
                :key="segmentIndex"
                :color="segment.color"
                :backgroundColor="segment.backgroundColor ?? line.backgroundColor"
                :bold="segment.bold"
                :italic="segment.italic"
                :dimColor="segment.dim"
                :underline="segment.underline"
                :strikethrough="segment.strikethrough"
              >{{ previewSegmentText(segment) }}</Text>
            </Text>
          </Box>
        </Box>

        <Box v-else-if="mainView === 'help'" flexDirection="column" :paddingTop="1">
          <Text bold color="#9ee493">{{ ui('KEYBOARD REFERENCE', '键盘操作参考') }}</Text>
          <Text :color="theme.muted">{{ keymapLabel }} · {{ ui('application actions use / commands; combinations below edit text only.', '应用功能使用 / 命令；以下组合键仅用于文本编辑。') }}</Text>
          <Text><Text color="cyan" bold>/help · /rename · /delete</Text> {{ ui('all application actions use bottom slash commands', '应用功能均通过底部斜杠命令执行') }}</Text>
          <Text><Text color="cyan" bold>{{ tabLabel }} · ↑↓ · {{ enterLabel }} · e/q</Text> {{ ui('switch pane · move · open · edit/quit', '切换窗格 · 移动 · 打开 · 编辑/退出') }}</Text>
          <Text><Text color="cyan" bold>← / →             </Text>{{ ui('collapse / expand folder', '折叠 / 展开文件夹') }}</Text>
          <Text><Text color="cyan" bold>/ · /search · /file · /image</Text> {{ ui('commands / search / editor insertions', '命令 / 搜索 / 编辑器插入') }}</Text>
          <Text bold color="#f7c873">{{ ui('TEXT EDITING · ALL SYSTEMS', '文本编辑 · 所有系统') }}</Text>
          <Text><Text color="cyan" bold>{{ controlKey("F/R") }}           </Text>{{ ui('find / find and replace in the current note', '在当前笔记中查找 / 查找替换') }}</Text>
          <Text><Text color="cyan" bold>{{ controlKey("A/C/X/V") }}       </Text>{{ ui('select all / copy / cut / paste', '全选 / 复制 / 剪切 / 粘贴') }}</Text>
          <Text><Text color="cyan" bold>{{ controlKey("Z/Y") }}           </Text>{{ ui('undo / redo', '撤销 / 重做') }} · {{ controlKey("Z", true) }} {{ ui('also redoes', '也可重做') }}</Text>
          <Text><Text color="cyan" bold>{{ isMacKeymap ? "⇧←/→/↑/↓" : "Shift+arrows" }}       </Text>{{ ui('extend selection by character or line', '按字符或行扩展选择') }}</Text>
          <Text><Text color="cyan" bold>{{ isMacKeymap ? "⌥←/→ · ⌥↑/↓" : "Ctrl+←/→ · Ctrl+↑/↓" }}</Text> {{ ui('word / paragraph', '单词 / 段落') }} · {{ shiftLabel }} {{ ui('selects', '选择') }}</Text>
          <Text><Text color="cyan" bold>{{ isMacKeymap ? "⌘←/→ · ⌘↑/↓" : "Home/End · Ctrl+Home/End" }}</Text> {{ ui('line/document edge', '行/文档边界') }} · {{ shiftLabel }} {{ ui('selects', '选择') }}</Text>
          <Text><Text color="cyan" bold>{{ isMacKeymap ? "⌃⌫/⌦ · ⌃U/K" : "Ctrl+Backspace/Del · Ctrl+U/K" }}</Text> {{ ui('word delete · delete to line edge', '删除单词 · 删除至行边界') }}</Text>
          <Text><Text color="cyan" bold>{{ ui('Mouse', '鼠标') }}              </Text>{{ ui('click cursor · drag selection · wheel scroll', '点击定位 · 拖动选择 · 滚轮滚动') }}</Text>
        </Box>

        <Box v-else-if="mainView === 'backlinks'" flexDirection="column">
          <Box :height="2" :flexShrink="0" alignItems="center">
            <Text bold color="#c792ea">{{ ui('BACKLINKS', '反向链接') }} · {{ activeNote?.title }}</Text>
            <Box :flexGrow="1" />
            <Text :color="theme.muted">{{ ui(`${activeBacklinks.length} references`, `${activeBacklinks.length} 个引用`) }}</Text>
          </Box>
          <Text v-if="!activeBacklinks.length" :color="theme.muted">{{ ui('No notes link here yet.', '尚无笔记链接到这里。') }}</Text>
          <Text v-for="note in activeBacklinks" v-else :key="note.id" :color="theme.foreground">← <Text color="cyan" underline>{{ note.title }}</Text>  <Text dimColor>{{ note.relativePath }}</Text></Text>
        </Box>

        <Box v-else-if="activeNote" ref="readBox" flexDirection="column">
          <Box :height="2" :flexShrink="0" alignItems="center">
            <Text bold :color="theme.foreground" wrap="truncate">{{ activeNote.title }} · {{ graphics?.label ?? ui('thumbnail', '缩略图') }}</Text>
            <Box :flexGrow="1" />
            <Text v-if="activeNote.tags.length" :color="theme.muted" wrap="truncate">{{ activeNote.tags.map(tag => `#${tag}`).join(" ") }}</Text>
          </Box>
          <Text v-for="(line, index) in visiblePreview" :key="scrollOffset + index" :color="theme.foreground" wrap="truncate">
            <Text :backgroundColor="line.backgroundColor">{{ "  ".repeat(line.indent) }}</Text><Text
              v-for="(segment, segmentIndex) in line.segments"
              :key="segmentIndex"
              :color="segment.color"
              :backgroundColor="segment.backgroundColor ?? line.backgroundColor"
              :bold="segment.bold"
              :italic="segment.italic"
              :dimColor="segment.dim"
              :underline="segment.underline"
              :strikethrough="segment.strikethrough"
            >{{ previewSegmentText(segment) }}</Text>
          </Text>
        </Box>

        <Box v-else :paddingTop="2" flexDirection="column" alignItems="center">
          <Text bold color="#9ee493">{{ ui('Your lattice is empty', '你的 Lattice 还是空的') }}</Text>
          <Text :color="theme.muted">{{ ui('Use /new to create the first note.', '使用 /new 创建第一篇笔记。') }}</Text>
        </Box>
      </Box>
    </Box>

    <Box v-if="commandDock" flexDirection="column" :height="dockHeight" :flexShrink="0" :paddingX="1" overflow="hidden">
      <Box v-if="mode === 'commands'" flexDirection="column" :flexShrink="0">
        <Box :height="1" :flexShrink="0" alignItems="center">
          <Text bold :color="theme.accent">◆ {{ ui('COMMANDS', '命令') }}</Text>
          <Box :flexGrow="1" />
          <Text :color="theme.muted">{{ filteredCommands.length ? commandIndex + 1 : 0 }} / {{ filteredCommands.length }}</Text>
        </Box>
        <Box v-if="!filteredCommands.length" :height="1" :flexShrink="0"><Text :color="theme.muted">{{ ui('No matching command. Backspace to change the filter.', '没有匹配的命令。按退格键修改筛选内容。') }}</Text></Box>
        <Box v-for="(command, index) in filteredCommands.slice(commandStart, commandStart + commandRows)" :key="command.label" :height="1" :flexShrink="0"
          :backgroundColor="index + commandStart === commandIndex ? theme.accent : undefined">
          <Text :bold="index + commandStart === commandIndex" :color="index + commandStart === commandIndex ? theme.background : theme.foreground"
            wrap="truncate">{{ index + commandStart === commandIndex ? ' › ' : '   ' }}/{{ commandName(command.label) }}  ·  {{ command.title }}</Text>
        </Box>
      </Box>
      <Box :height="3" :flexShrink="0" :paddingX="1" borderStyle="round" :borderColor="mode === 'commands' ? theme.accent : theme.border">
        <Text v-if="mode === 'commands'" :color="theme.foreground" wrap="truncate"><Text bold :color="theme.accent">❯ </Text>/{{ promptValue.replace(/^\//, '').slice(-Math.max(1, layout.width.value - 10)) }}<Text inverse> </Text></Text>
        <Text v-else :color="theme.muted" wrap="truncate">❯ {{ mode === 'edit' ? ui(`${escapeLabel} to browse, then / for commands`, `${escapeLabel} 返回浏览，然后按 / 打开命令`) : ui('Type / for commands', '输入 / 打开命令') }}</Text>
      </Box>
    </Box>

    <Box
      :height="2"
      :flexShrink="0"
      :paddingX="1"
      alignItems="center"
      borderTop
      :borderBottom="false"
      :borderLeft="false"
      :borderRight="false"
      borderStyle="single"
      :borderColor="theme.border"
    >
      <Box :flexGrow="1" :flexShrink="1" overflow="hidden">
        <Text v-if="mode === 'import'" :color="theme.accent" wrap="truncate">{{ ui('IMPORT', '导入') }} › {{ promptValue }}<Text inverse> </Text></Text>
        <Text v-else-if="mode === 'search'" color="cyan" wrap="truncate">/ {{ query }}<Text inverse> </Text></Text>
        <Text v-else-if="mode === 'create'" color="cyan" wrap="truncate">{{ ui('NEW', '新建') }} › {{ promptValue }}<Text inverse> </Text></Text>
        <Text v-else-if="mode === 'create-folder'" color="yellow" wrap="truncate">{{ ui('NEW FOLDER', '新建文件夹') }} › {{ promptValue }}<Text inverse> </Text></Text>
        <Text v-else-if="mode === 'rename'" color="yellow" wrap="truncate">{{ ui('RENAME', '重命名') }} › {{ promptValue }}<Text inverse> </Text></Text>
        <Text v-else-if="mode === 'pick-file'" color="cyan" wrap="truncate">{{ ui('VAULT FILE', 'VAULT 文件') }} › {{ promptValue }}<Text inverse> </Text></Text>
        <Text v-else-if="mode === 'confirm-quit' || mode === 'confirm-delete'" bold color="yellow" wrap="truncate">{{ status }}</Text>
        <Text v-else :color="statusIsError ? 'red' : theme.muted" wrap="truncate">{{ status }}</Text>
      </Box>
      <Box :flexShrink="0" :paddingLeft="1"><Text :color="theme.muted" wrap="truncate">{{ footerHint }}</Text></Box>
    </Box>
  </Box>
</template>
