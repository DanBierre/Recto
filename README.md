# Recto

A small, quiet text editor for Windows. It opens fast, stays out of the way, and doesn't ask you to sign in to anything.

I built it because I wanted something between Notepad and Sublime: quick enough to open a log file, good enough to write code in.

*Recto* is the right-hand page of an open book. It's the page you start writing on.

## What it does

- Tabs that come back after a restart, unsaved ones included
- Syntax highlighting for the usual languages
- Go to file, go to line, go to symbol and a command palette
- Find and replace, plus find in files across an open folder
- Multiple cursors, column select, move and duplicate lines
- Markdown preview
- Print, or export to PDF, a web page, a Word document or plain text (`Ctrl+Shift+E`)
- Turn a CSV into JSON and back again, each into a new tab
- Opens more than text: pictures and PDFs to look at, CSV files as a table, and the words out of Word files
- Eight themes to pick from: Paper, Ink, Cloud, Slate, Sage, Forest, Rose and Plum, or follow Windows light and dark
- Three layouts: Classic, Page (a centred sheet, nice for writing) and Focus
- A reading font for notes and prose (serif, sans or mono), with code staying in mono
- Keeps your file's encoding (UTF-8, UTF-16, Windows-1252) and line endings as they were
- Can start with a blank page instead of your last files, if you'd rather
- "Edit with Recto" in the Explorer right-click menu

## Why Recto

Most of these came from people's gripes about the editors they already use. Recto just doesn't do the annoying bit.

- **No AI, no account.** It's a text editor. There's nothing to sign in to and nothing trying to finish your sentences.
- **No licence pop-ups or update nags.** It's free, and it won't interrupt you to say so.
- **Sends nothing.** No telemetry, no crash reports, no phoning home. Your words stay on your computer.
- **Quiet notes instead of pop-ups.** Saved, exported, reloaded: a small note shows in the corner and fades. Nothing to click away.
- **No clutter.** No toolbars, no ribbon, no minimap. Focus mode (`F11`) hides the rest too.
- **Settings live in the command palette.** Type what you want to change. No settings page to dig through.
- **Reloads saved files quietly.** If another program changes a file you haven't touched, Recto just shows the new version. If you've got unsaved edits, it keeps them and lets you know, so you choose.
- **Unsaved tabs come back.** Close it, restart Windows, whatever. Your drafts are there next time.
- **Opening a file twice goes to the tab you've already got.** No second copy to get confused by.
- **No preview tabs.** A file you open stays open until you close it.
- **Opens in about three-quarters of a second.** Measured on a normal laptop, cold start to cursor.

## Shortcuts

| Keys | Does |
| --- | --- |
| `Ctrl+P` | Go to file |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+G` / `Ctrl+R` | Go to line / symbol |
| `Ctrl+F` / `Ctrl+H` | Find / replace |
| `Ctrl+Shift+F` | Find in files |
| `Ctrl+D` | Select next match |
| `Ctrl+Shift+L` | Cursor on each selected line |
| `Ctrl+Shift+D` | Duplicate line |
| `Ctrl+Shift+K` | Delete line |
| `Ctrl+/` | Toggle comment |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+B` | Sidebar |
| `Ctrl+Shift+M` | Markdown preview |
| `F11` | Focus mode |
| `Ctrl+Shift+E` | Export or print |
| `Alt+Z` | Word wrap |

The command palette lists the rest.

## Build it yourself

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

To make the Windows installer:

```bash
npm run dist
```

The installer ends up in `release/`. It installs for your user only, so it doesn't need admin rights.

To run the tests:

```bash
npm test
npm run check
```

## Built with

[Electron](https://www.electronjs.org) and [CodeMirror 6](https://codemirror.net).

## Licence

MIT. See [LICENSE](LICENSE).
