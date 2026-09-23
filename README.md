# Lattice

Lattice is an Obsidian-inspired Markdown knowledge base that lives entirely in the terminal. It is built with Vue 3 and [vue-tui](https://github.com/vuejs-ai/vue-tui), and works with ordinary folders of Markdown files—there is no proprietary database or lock-in.

## Features

- Keyboard-first vault navigation with a responsive file tree, editor and live-preview layout
- Full selected file/folder path shown above the workspace even when the tree label is truncated
- Expandable folder tree with create, rename and confirmed file/folder deletion
- Markdown preview with distinct H1–H6 hierarchy, aligned Unicode tables and clickable links
- Fenced/indented code blocks with language labels, line numbers and lightweight syntax highlighting
- Editor slash commands for quickly inserting common Markdown blocks
- `/image` selects a Vault image in the CLI; `Ctrl+V` pastes a clipboard image into document-managed attachments
- Native Kitty image previews with responsive sizing and scrolling; colour thumbnails on other terminals
- Multiline editor with mouse positioning/drag selection, clipboard copy/cut, undo/redo and atomic saves
- In-note find and replace with cyclic matching, replace-current/replace-all actions and undo support
- Full-vault search with snippets, highlighting, fuzzy title matching, phrases, filters and sorting
- Obsidian-style `[[wiki links]]`, editor completion, link navigation, contextual backlinks and broken-link checks
- Tag extraction, nested folders, command palette and unsaved-change protection
- Deterministic tests for Markdown, editing and vault behavior

## Bottom slash-command input

The primary action entry is now a persistent, bordered input at the bottom of the workspace. In browse mode, type **/** to focus it and open suggestions above the input; the document stays visible. Type a name or description to filter, use **↑/↓** to choose, **Tab** to complete, **Enter** to run and **Escape** to cancel. PageUp/PageDown and Home/End navigate long menus. The menu adapts to terminal height and keeps the selected row visible. Unknown commands do not execute or close the input.

| Command | Action |
| --- | --- |
| `/jot` | Start a quick note |
| `/summarize` | Review and confirm AI organization of a saved note |
| `/model` | Configure the model provider |
| `/settings` | Open preferences |
| `/import`, `/move` | Import or move files/folders |
| `/new`, `/folder`, `/rename` | Create or rename entries |
| `/delete` | Move the selected Markdown file or folder to recoverable Trash after confirmation |
| `/trash` | Browse and restore deleted files or folders |
| `/links` | Check unresolved Wiki links |
| `/backlinks` | Show references to the current note with source lines |
| `/search` | Search the vault with filters and sorting |
| `/help`, `/quit` | Help and quit |

While editing a document, `/save` saves the draft and `/file` or `/image` inserts a Vault attachment. Escape returns to browse; if the Markdown quick-insert menu is open, the first Escape closes that menu. Then type `/` to operate the bottom command input. Other Markdown slash insertions, such as `/code`, remain editor-only. Unsaved content and the current document are preserved when opening or cancelling the command menu. Application actions have no prefix, function-key or Command-key alternatives; browse mode retains `e` for edit and `q` for quit.

## Requirements

- Node.js 22.18 or newer
- macOS, Linux, or Windows with Node.js 22.18+
- An interactive terminal (Windows Terminal, PowerShell, iTerm2 and common Linux terminals are supported)

## Run

Install the published CLI:

```bash
npm install -g lattice-tui
lattice
```

The first run creates `~/Documents/Lattice` with a welcome note. After that, `lattice` reopens the most recently used Vault from any directory. Pass a path only when switching Vaults—for example, `lattice ~/Documents/MyVault`; that choice becomes the new default for the next launch.

Or run from source:

```bash
pnpm install
pnpm build
pnpm start
```

The source checkout includes a sample vault at `./examples/vault`. Open it or pass any other Markdown folder:

```bash
node dist/main.mjs ./examples/vault
```

Windows PowerShell:

```powershell
node .\dist\main.mjs --vault C:\Users\me\Documents\MyVault
```

For terminals with limited alternate-screen or color support, use `--inline` and/or `--no-color`. Run `node dist/main.mjs --help` for all CLI options.

During development, use `pnpm dev`. Run all checks with `pnpm check`.

Website: [wenwenba.github.io/Lattice](https://wenwenba.github.io/Lattice/) · Mirror: [lattice-tui.chnova-6234.chatgpt.site](https://lattice-tui.chnova-6234.chatgpt.site) · Source: [github.com/wenwenba/Lattice](https://github.com/wenwenba/Lattice)

## Keys

### Icon language

Lattice uses Nerd Font icons directly. Configure a Nerd Font Mono in your terminal before running the CLI; Lattice does not install or change terminal fonts. The website demo embeds only the required glyphs, and folder, note and image icons use distinct colors tuned for every built-in theme.

Use `/move` for the full-width three-step picker: choose source, choose destination, confirm move. Type to search, use arrows or PageUp/PageDown to navigate, Home/End to jump, and Ctrl+U to clear search. The list adapts to window height and keeps the selection visible. Enter advances; the last Enter confirms the displayed source/destination. `/ (Vault root)` moves it back to the root. Escape goes back or cancels. Name conflicts are rejected without overwriting; a folder cannot move inside itself. Save unsaved edits before moving. Markdown-managed images use the existing rename migration. Resolvable inbound Wiki links are updated to the moved note path; ordinary Markdown links are not rewritten.

Use `/import` after selecting the destination folder in the vault (selecting a note uses its parent folder), then enter or paste a local source path and press Enter. Folders are copied recursively, originals are preserved, and name conflicts get numeric suffixes. Symbolic links/special files and copying a folder into its own descendants are rejected. Paths refer to the machine running Lattice, including when running over SSH.

The import screen shows the destination before copying. Enter one path at a time; press Enter (`↩` on macOS) to import, Escape (`⎋`) to cancel, or Ctrl+U (`⌃U`) to clear the path. If dragging from Finder inserts a path into your terminal, you can use it in this field: check that it is a plain path, removing shell escape backslashes if necessary. Dragging does not select a destination tree node; the previously selected vault directory remains the target.

Use `/settings`. Use ↑/↓ to choose a setting, ←/→ or Enter to change it, and Esc to return. Auto save is on by default and saves after one second without typing; `/save` remains available inside the editor. Failed saves leave the draft intact and report an error. Available themes are Lattice, Nord, Dracula and Paper (light). Interface languages are English and Simplified Chinese; translated command descriptions keep the same stable slash names. Trash retention defaults to 30 days and can be set to 7, 30 or 90 days. Changes apply immediately and persist per vault in `.lattice/settings.json`, hidden from the navigator.

Every selectable list wraps with ↑/↓: pressing ↑ on its first item selects the last item, and pressing ↓ on its last item selects the first. PageUp/PageDown and Home/End continue to stop at list boundaries.

| Key | Action |
| --- | --- |
| `Ctrl+V` on all systems | Paste a local clipboard image or text into the editor |
| `Ctrl+A/C/X` on all systems | Select all, copy selection, cut selection |
| `Ctrl+Z`, `Ctrl+Y` or `Ctrl+Shift+Z` | Undo, redo |
| `Ctrl+F` / `Ctrl+R` | Find / find and replace inside the current note |
| `Shift+←/→/↑/↓` in editor | Extend the text selection |
| `Home` / `End`, with `Shift` | Move to line start/end, or select to it |
| `Ctrl+Home` / `Ctrl+End`, with `Shift` | Move to document start/end, or select to it |
| `Ctrl+←/→`, with `Shift` | Move/select by word |
| `Ctrl+Backspace/Delete` | Delete previous/next word |
| `PageUp` / `PageDown`, with `Shift` | Move/select by a viewport of lines |
| `Tab` | Switch navigator / note pane |
| `↑`, `↓`, `PageUp`, `PageDown`, `Home`, `End` | Move selection or scroll |
| `Enter` | Open the selected note directly in the editor, or follow a selected wiki link |
| `e` | Enter edit mode for the selected note |
| `q` | Quit Lattice; unsaved edits require confirmation |
| `←`, `→` | Collapse or expand the selected folder |
| `/` in browse mode | Open the bottom application-command input |
| `/` while editing | Open the Markdown quick-insert menu |
| `Esc` | Leave editing and return focus to the VAULT, close a menu, or cancel a prompt |

Lattice reads and writes Markdown notes and image attachments inside the selected vault. Note saves are written to a temporary sibling and renamed into place, reducing the risk of a partial file if a write is interrupted. Clipboard access is local and only happens when explicitly copying, cutting or pasting.

When creating a note or folder, `/` creates nested paths such as `Projects/2026/Ideas`. While renaming, `Ctrl+U` clears the current name. `/delete` moves the selected Markdown file or folder into `.lattice/trash` after confirmation. Use `/trash`, ↑/↓ and Enter to restore. A conflict at the original path receives a ` (restored 2)` suffix rather than overwriting the current file. Moving a folder to Trash includes its contents. Deleting a note leaves its managed attachment directory in place because another note may reference those files. Expired Trash entries are permanently removed when Lattice starts, when `/trash` opens, and hourly while Lattice runs. Lattice does not run a background process while closed; an entry that expires while it is closed is removed on the next launch. Permanent removal cannot be undone from Lattice.

Use `/search` to filter by words or a quoted phrase. Results show a matching line and highlight the first match. Add `tag:name`, `path:folder`, `link:target`, `before:YYYY-MM-DD`, or `after:YYYY-MM-DD`; combine filters with words. `sort:recent` orders by file modification time, `sort:title` by title, and `sort:relevance` restores the default. A close spelling in the title can match even when the text does not. Search reads the currently loaded Vault; use `/reload` after external file changes.

While editing, type `[[` to choose a note. ↑/↓ selects a suggestion and Enter or Tab inserts its path. If no note matches the typed name, Enter creates it. Escape closes the suggestions without removing the text. Select text and use the editor's `/extract-note` command to move it into a new Markdown note and replace the selection with a Wiki link. Use `/links` to list unresolved or ambiguous Wiki links. Frontmatter `aliases: [name]` and YAML list aliases resolve as link targets. In browse mode, Tab focuses the note, `[`/`]` selects a Wiki link, and Enter follows it; the backlinks view shows the source line for each reference.

In the editor, `/` opens a searchable quick-insert menu. For example, type `/code`, `/table`, `/task`, `/link`, or `/callout`, then press `Enter` or `Tab` to insert the selected Markdown structure. Use `/file` to open the in-terminal Vault file selector, or `/save` to save without leaving the editor. Type to filter, use `↑`/`↓` to choose, and press `Enter` to insert a path relative to the current note.

HTTP, HTTPS, email, absolute file and relative Markdown links are emitted as OSC 8 terminal hyperlinks in preview. They can be clicked in terminals that support OSC 8, including current Windows Terminal and iTerm2 releases; unsupported terminals still show the styled link label. Vault file selection never opens an operating-system dialog and never lists files outside the active Vault.

Application actions use `/` on every system. Text navigation follows the selected system; clipboard and undo/redo commands use Control everywhere. macOS hints use `⌘` Command, `⌃` Control, `⌥` Option, `⇧` Shift, `⇥` Tab, `↩` Return, `⌫` Backspace, `⌦` Forward Delete and `⎋` Escape. Unsupported modifier combinations are ignored, preserving AltGr input.

Opening a note from the file tree or search results enters edit mode immediately. The editor and rendered Markdown preview stay visible side by side and update together; on terminals narrower than 96 columns, the file tree is temporarily hidden while editing to preserve both work panes. Long preview paragraphs, lists, quotes and code lines wrap to the available terminal width and scroll vertically instead of being horizontally truncated.

### Text editing and mouse

The keymap follows the OS running Lattice. Override it with `--keymap macos`, `--keymap windows`, or `--keymap linux` when your keyboard differs from the remote host. `--keymap auto` restores automatic selection. The keymap controls text navigation/selection and their labels; clipboard ownership and terminal configuration are unchanged.

| Editor action | Key on every system |
| --- | --- |
| Select all / copy / cut / paste | Ctrl+A/C/X/V |
| Undo / redo | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z |
| Move/select by word | macOS: ⌥←/→ (+⇧); Windows/Linux: Ctrl+←/→ (+Shift) |
| Move/select to line edge | macOS: ⌘←/→ (+⇧); Windows/Linux: Home/End (+Shift) |
| Move/select to paragraph edge | macOS: ⌥↑/↓ (+⇧); Windows/Linux: Ctrl+↑/↓ (+Shift) |
| Move/select to document edge | macOS: ⌘↑/↓ (+⇧); Windows/Linux: Ctrl+Home/End (+Shift) |
| Delete previous/next word | Ctrl+Backspace/Delete |
| Delete to line start/end | Ctrl+U/K |

Navigation and selection follow the selected OS. Paragraph boundaries are hard newlines in the unwrapped source editor. macOS Option+Right stops at the next word end without selecting trailing spaces; Windows/Linux Ctrl+Right moves to the next word start. Unicode word segmentation supports Chinese. Adding Shift preserves the original selection anchor, including when reversing direction. Clipboard and undo/redo shortcuts remain Ctrl-based on every system.

Ctrl+W also deletes the previous word. Text operations are available only inside the editor and are intentionally absent from the browse-mode `/` command list. No key can be handled by Lattice if the OS or terminal consumes it first. Lattice does not rewrite terminal keybindings automatically.

In fullscreen mode, click inside the editor to position the caret, drag to select across lines, or Shift-click to extend the selection. The wheel scrolls the editor; dragging above/below it scrolls as the pointer moves. Click positions and arrow movement account for Chinese characters, emoji, combining accents and tabs. Long lines scroll horizontally to keep the keyboard caret visible.

Typing, pasting, Backspace and Delete replace/remove selected text. Copy/cut use the system clipboard; a failed copy leaves the original text intact. In the editor, **Ctrl+C** (`⌃C` in macOS hints) copies on every system; quit uses `/quit`. Esc leaves editing, or closes an open Markdown slash menu first. Undo history is kept for the current document, including across saves, and is bounded to 100 edits / 8 million characters of snapshots; switching documents clears it.

In the editor, **Ctrl+F** opens literal, case-sensitive find and **Ctrl+R** opens find and replace on every system (`⌃F` / `⌃R` in macOS hints). Enter selects the next match and Shift+Enter selects the previous match, wrapping at either end. In replace mode, Tab cycles through Find, Replace, Current and All; Enter executes the selected action. Ctrl+U clears the active field and Escape closes the panel. Each current/all replacement is one undoable editor operation. Searches and replacements are single-line and do not interpret regular expressions.

Mouse tracking requires a terminal forwarding SGR mouse reports. It is enabled only while editing, and released for menus and on exit. To use the terminal's own selection or clickable preview links while editing, use its mouse-override modifier (terminal-dependent), or disable application mouse tracking with `LATTICE_MOUSE=off`. `--inline` also keeps native terminal mouse behavior. On Windows PowerShell, set `$env:LATTICE_MOUSE="off"` before launching. This does not disable keyboard selections.

Linux copying requires `wl-copy` (Wayland, from `wl-clipboard`) or `xclip` (X11); macOS and Windows use the same built-in clipboard facilities listed below. Double/triple-click word/line selection is not implemented.

### Images

Place images in any Vault folder (for example `assets/`). While editing, type `/image` then Enter and filter by filename. The highlighted image is previewed immediately; ↑/↓ switches the preview, Enter inserts it, and Esc cancels without replacing your text. Wide windows show the list and preview side by side; narrow windows hide the Vault sidebar and place the preview below the list. Previews fit the available space and reuse the active renderer (including Warp's `Kitty native` path). Empty results clear the preview, and unreadable images show an error without changing your note. The file list refreshes when opened.

#### Paste clipboard images

Copy a screenshot/image, enter a note, and press **Ctrl+V** on any system. A clipboard image is converted to PNG and inserted using a relative Markdown reference. The shortcut also accepts text. There is no separate clipboard-image tool in the command palette or slash menu. Normal terminal text pastes remain plain text and do not read a stale image from the system clipboard.

Terminals may consume Ctrl+V themselves, and raw image bytes are not part of the bracketed-paste text protocol. Configure the terminal to forward Ctrl+V when clipboard-image insertion is needed. Clipboard access refers to the machine running Lattice, not the local machine's clipboard over SSH.

| Platform | Clipboard adapter |
| --- | --- |
| macOS | Built-in AppKit via `osascript`; PNG or TIFF converted to PNG |
| Windows | PowerShell STA + System.Windows.Forms Clipboard / System.Drawing |
| Linux Wayland | `wl-paste` from `wl-clipboard`; PNG MIME target |
| Linux X11 | `xclip`; PNG MIME target |

Document-managed `.assets` directories and their descendants are hidden from the note navigator and note search. Their files remain on disk and available to `/image` and `/file`; normal folders named `assets` are not hidden.

Example document-managed layout:

```text
Projects/
  Plan.md
  Plan.assets/
    image-<content-hash>.png
```

Repeated pastes of the same PNG into the same document reuse the file; different documents get separate attachment directories. Images are saved immediately, while the Markdown reference is saved by auto-save or `/save`. Removing a reference or discarding an edit does not delete image files. When a document is renamed/moved **inside Lattice**, its referenced managed images are copied to the new matching `.assets` directory and references are updated. Originals remain available to other notes; no automatic orphan deletion occurs. Renaming a parent folder carries its notes and attachments together. External filesystem renames do not rewrite references.

#### Native terminal display

Images use `![filename](relative/path.png)` and render in both live and read-only preview. This keeps `@vue-tui/runtime` and adapts the Kitty protocol described in [Vue TUI's terminal-image guide](https://vue-tui.pages.dev/guide/terminal-image-rendering); it does not import components from the separate `@simon_he/vue-tui` framework.

On Warp/WezTerm in fullscreen mode, PNG pixels use **regular Kitty image placements**, not Unicode placeholders. Images are drawn after the Vue text frame, positioned using measured pane coordinates, and cropped to the visible viewport. Scrolling, resize and menus update/remove placements without re-uploading unchanged images. [Warp documents support for the Kitty image protocol](https://docs.warp.dev/terminal/more-features/files-and-links).

On Kitty/Ghostty, PNG pixel data uses [Unicode virtual-placement cells](https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders) in the Vue layout. Both paths display real pixels, not coloured character approximations. Exit removes only Lattice's images. Other terminals use the colour half-block thumbnails. The preview title labels the active path: `Kitty native`, `Kitty`, or `thumbnail`. Click the image label in an OSC 8-compatible terminal to open the original.

Auto-detection recognizes Warp/WezTerm and Kitty/Ghostty environment markers. After updating, save your note and restart Lattice so the new renderer is loaded. If Warp is still showing `thumbnail`, use:

```bash
LATTICE_GRAPHICS=kitty-native node dist/main.mjs --vault /path/to/your/vault
```

Regular placements require the default fullscreen mode; `--inline` falls back to thumbnails on Warp/WezTerm. `LATTICE_GRAPHICS=kitty` selects regular placements on Warp/WezTerm and Unicode placements elsewhere. `LATTICE_GRAPHICS=off` forces thumbnails. `VUE_TUI_TERMINAL_GRAPHICS` / `VUE_TUI_GRAPHICS_PROTOCOL` accept the same values, plus `auto` and `unicode`. No iTerm2/Sixel output or multiplexer passthrough is implemented. Non-TTY, CI, `NO_COLOR`, `--no-color`, tmux, screen and zellij disable native graphics. Do not force Unicode placeholders on terminals that only support regular Kitty placements.

Non-interlaced 8-bit PNGs decode directly with Node, including palette and transparency. JPEG, GIF (first frame), WebP, BMP, TIFF and other PNG variants use macOS `sips`, Windows System.Drawing, or Linux ImageMagick (`magick`) when available; format support varies by converter. Native PNG display keeps source pixels; macOS/Linux conversion is bounded to 2048 pixels on the longest edge (256 for thumbnail fallback). Missing, unsupported or corrupt images display an error and keep the link. Local previews are limited to files inside the Vault, 20 MB per source and 16 megapixels for direct PNG decoding. The native session cache is bounded to 64 MB; if full, further images show an unavailable notice until restarting. Remote image URLs remain clickable but are not fetched automatically.

## Platform support

- File paths use native Windows or POSIX resolution, including drive-letter paths.
- Save operations use atomic rename where supported and a guarded Windows replacement fallback.
- The npm executable shim works on Windows; POSIX builds are marked executable automatically.
- `--no-color` and `--inline` provide fallbacks for restricted terminals.
- CI runs type checks, tests, and builds on Ubuntu, macOS, and Windows.
# Quick notes and AI organization

Application actions are deliberately modifier-free: leave the editor with Escape, type `/`, filter the command and press Enter. This avoids collisions with Warp, Ghostty, desktop applications and system function keys. The browse-mode letter shortcuts are `e` to edit and `q` to quit.

New quick-note titles use local system time, for example `2026-09-08 09:05:03`. Filenames use `2026-09-08 09-05-03.md` to avoid Windows' colon restriction. Older notes are not renamed. The timezone is the machine running Lattice (the remote host when using SSH).

- `/jot` creates a timestamped Markdown note in `Quick Notes/` and opens the regular editor. Existing unsaved edits must be saved first. Auto-save remains enabled by default; `/save` saves explicitly.
- `/summarize` organizes the current saved note (including regular notes). Review the destination and press Enter to send. Nothing is sent just by opening the panel. Escape cancels an in-flight request; ↑/↓ and PageUp/PageDown scroll the result. Enter on the result saves a sibling ` - Summary.md` file without replacing the original; Escape discards the result. Filename collisions receive a numeric suffix.
- `/model` opens provider configuration. ↑/↓ or Tab selects a field; ←/→ on Provider selects a preset and resets its fields. The first typed or pasted value replaces the preset value instead of being appended to it. Ctrl+U clears a field and Backspace removes a character. Enter advances to the next field and saves from the final API Key field; Escape cancels. The key is masked on screen.

Presets include OpenAI, DeepSeek, Qwen, Zhipu, Claude, Gemini, Ollama and custom OpenAI-compatible endpoints. Model IDs and base URLs are editable; availability depends on your account and region. Qwen defaults to its China endpoint; replace it for another region. Ollama requires a locally installed model matching the configured name. Claude uses the Messages API; Gemini uses generateContent; the others use Chat Completions.

The API key is stored directly in `.lattice/ai.json` with user-only file permissions where the platform supports them. Do not commit or share this file, and take care when syncing the Vault. Old `keyEnv` configurations are rejected rather than migrated; open `/model` and save a new configuration. Keyless local endpoints such as Ollama may leave API Key empty. Remote endpoints require a key and HTTPS; HTTP is allowed only on localhost. Redirects are rejected to prevent forwarding credentials.

Only the selected note's saved Markdown is sent, including any sensitive text or link URLs it contains; linked files, images and other vault notes are not uploaded. The configured provider may retain data and charge for requests. Requests time out after 90 seconds and notes above 200 KB are rejected. There are no automatic retries or background AI calls. Generated text is untrusted: review it for omissions and mistakes before saving. Results are shown as scrollable plain Markdown and are fully previewable/editable after saving.
