import { computed, shallowRef, type ShallowRef } from 'vue';
import { insertText, selectionRange, selectedText, setCursor, type EditorState } from './editor.js';

export type FindMode = 'closed' | 'find' | 'replace';
export type FindTarget = 'find' | 'replace' | 'one' | 'all';

export interface FindResult {
  state: EditorState;
  current: number;
  total: number;
}

export function findMatches(content: string, query: string): Array<{ start: number; end: number }> {
  if (!query) return [];
  const matches: Array<{ start: number; end: number }> = [];
  for (let start = content.indexOf(query); start >= 0; start = content.indexOf(query, start + Math.max(1, query.length))) {
    matches.push({ start, end: start + query.length });
  }
  return matches;
}

export function selectMatch(state: EditorState, query: string, direction: 1 | -1 = 1): FindResult {
  const matches = findMatches(state.content, query);
  if (!matches.length) return { state: { ...state, anchor: undefined }, current: 0, total: 0 };
  const range = selectionRange(state);
  const selected = selectedText(state) === query ? matches.findIndex(match => match.start === range.start) : -1;
  let index: number;
  if (selected >= 0) index = (selected + direction + matches.length) % matches.length;
  else if (direction > 0) {
    index = matches.findIndex(match => match.start >= state.cursor);
    if (index < 0) index = 0;
  } else {
    index = matches.findLastIndex(match => match.end <= state.cursor);
    if (index < 0) index = matches.length - 1;
  }
  const match = matches[index]!;
  return { state: { content: state.content, cursor: match.end, anchor: match.start }, current: index + 1, total: matches.length };
}

export function replaceCurrent(state: EditorState, query: string, replacement: string): FindResult & { replaced: boolean } {
  if (!query || selectedText(state) !== query) return { ...selectMatch(state, query), replaced: false };
  const next = selectMatch(insertText(state, replacement), query);
  return { ...next, replaced: true };
}

export function replaceAll(state: EditorState, query: string, replacement: string): FindResult & { replaced: number } {
  const matches = findMatches(state.content, query);
  if (!matches.length) return { state: { ...state, anchor: undefined }, current: 0, total: 0, replaced: 0 };
  const content = state.content.split(query).join(replacement);
  return { state: { content, cursor: Math.min(content.length, state.cursor) }, current: 0, total: 0, replaced: matches.length };
}

export function useFindReplace(editor: ShallowRef<EditorState>) {
  const mode = shallowRef<FindMode>('closed');
  const target = shallowRef<FindTarget>('find');
  const query = shallowRef('');
  const replacement = shallowRef('');
  const matches = computed(() => findMatches(editor.value.content, query.value));
  const current = computed(() => {
    const range = selectionRange(editor.value);
    const index = selectedText(editor.value) === query.value ? matches.value.findIndex(match => match.start === range.start) : -1;
    return index + 1;
  });
  const collapseSelection = () => { editor.value = setCursor(editor.value, editor.value.cursor); };
  function open(nextMode: Exclude<FindMode, 'closed'>) {
    const selected = selectedText(editor.value);
    if (selected && !selected.includes('\n')) query.value = selected;
    mode.value = nextMode; target.value = 'find';
  }
  function close() { mode.value = 'closed'; }
  function cycleTarget(delta: number) {
    const targets: FindTarget[] = ['find', 'replace', 'one', 'all'];
    target.value = targets[(targets.indexOf(target.value) + delta + targets.length) % targets.length]!;
  }
  function update(value: string) {
    if (target.value === 'find') { query.value += value; collapseSelection(); }
    else if (target.value === 'replace') replacement.value += value;
  }
  function backspace() {
    if (target.value === 'find') { query.value = [...query.value].slice(0, -1).join(''); collapseSelection(); }
    else if (target.value === 'replace') replacement.value = [...replacement.value].slice(0, -1).join('');
  }
  function clear() {
    if (target.value === 'find') { query.value = ''; collapseSelection(); }
    else if (target.value === 'replace') replacement.value = '';
  }
  function next(direction: 1 | -1) { const result = selectMatch(editor.value, query.value, direction); editor.value = result.state; return result; }
  function replaceOne() { const result = replaceCurrent(editor.value, query.value, replacement.value); editor.value = result.state; return result; }
  function replaceEvery() { const result = replaceAll(editor.value, query.value, replacement.value); editor.value = result.state; return result; }
  return { mode, target, query, replacement, matches, current, open, close, cycleTarget, update, backspace, clear, next, replaceOne, replaceEvery };
}
