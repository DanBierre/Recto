# Recto: new-user audit

Date: 16 November 2026. Audited at app version 0.1.0 (Electron 43.8, driven with Playwright). This is a historical snapshot: findings 1 to 3 were fixed by 0.1.3 (focus after un-hide, off-screen window check, big-file note). Findings 4 to 11 have not been re-checked.

Nothing in the app was changed. This is a list for Dan to pick from.

## How this was done

- Ran the real app with a clean profile, as a first-time user: setup note, welcome screen, new file, open file, folders, themes, find, export, CSV, Markdown.
- Pushed on edge cases: read-only files, deleted files, big files, odd encodings, odd filenames, binary files, tiny windows, 30 tabs, a second launch.
- Read the code behind each problem (`main.js`, `src/app.js`, `index.html`, `build/setup.cs`).
- Keys were sent as Playwright keyboard events. Dan should confirm item 1 by hand (about 30 seconds).

## Not covered

- The installer (`Recto-Setup.exe`) was not run. It writes to the registry and makes shortcuts on a real machine. `build/setup.cs` was only read, not run.
- The dev run skips the registry and shortcut work (`setup:shell` only does it when the app is packaged). The right-click menu and desktop shortcut are unverified.
- Real-machine start time. The README says "about three-quarters of a second". That number is from Dan's original text and is unmeasured here.
- Screen readers, high-DPI scaling, multi-monitor.

## Ranked findings

### 1. HIGH: the first action from the welcome screen leaves the editor unfocused

- **What:** Open Recto with no tabs. Press `Ctrl+N`, or click **New file**, or open a file from Recent, `Ctrl+P` or the sidebar. The tab opens, but the cursor isn't in the editor. Typing does nothing until you click the text.
- **Where:** `src/app.js`, `activate()` (around line 99). It calls `view.focus()` before `#empty` is hidden and `#editor` is un-hidden, so the focus call hits a hidden element.
- **Why it matters:** It is the very first thing a new user does. "I typed and nothing happened" reads as a broken editor. Once any tab is open, focus works, so it is easy to miss when you test with files already open.
- **Check:** All four welcome-screen paths were tried. In each, `document.activeElement` stayed on `body` and typed text did not land.
- **Fix:** Focus after the editor is shown, for example `requestAnimationFrame(() => view.focus())`, or move the `view.focus()` call below the un-hide.

### 2. HIGH: the window can open off-screen

- **What:** Saved window bounds are restored as they are. With saved position x:-9000, y:-9000, the window opens somewhere you can't reach.
- **Where:** `main.js`, lines 63-69.
- **Why it matters:** Real triggers are an unplugged monitor, a docking station change, or a changed display layout. The user sees nothing, and reinstalling doesn't help because the settings survive.
- **Fix:** On start, check that the saved rectangle overlaps a display's `workArea` (`screen.getAllDisplays()`). If it doesn't, drop x and y and let Electron centre the window.

### 3. MEDIUM: big files are slow, with no feedback

- **What:** 5 MB opens in about 1.8 s. Typing 10 characters in a 5 MB file took 563 ms. 30 MB takes 6.3 s to open with no progress note. 60 MB is refused with a clear message ("over 50 MB").
- **Where:** File open path in `main.js` (50 MB limit) and CodeMirror in `src/app.js`.
- **Why it matters:** The README pitch says "quick enough to open a log file". Many logs are bigger than 50 MB, and the ones that open feel stuck.
- **Fix, in order of effort:**
  1. Show a flash note ("Opening…") for files over a few MB.
  2. Soften the pitch in the README, or add "up to 50 MB".
  3. Later: a read-only large-file mode that turns off highlighting.

### 4. MEDIUM/LOW: mixed line endings are changed without a word

- **What:** A file containing `a\r\nb\nc\r\n` is saved as all CRLF. No notice.
- **Where:** Line-ending handling on open and save.
- **Why it matters:** The README says Recto keeps "line endings as they were". True for pure CRLF or pure LF files, not for mixed ones. A diff in git would show every line changed.
- **Fix:** Either keep a per-line record (heavy), or show a flash note ("Mixed line endings, saved as CRLF"), or reword the README line to "keeps your file's line endings (mixed ones are tidied to one style)". The README wording is the lazy option.
- **Checked fine:** BOM + CRLF, UTF-16 LE and Windows-1252 all round-trip correctly.

### 5. MEDIUM/LOW: save errors show raw system text

- **What:** Saving a read-only file shows `Couldn't save: EPERM: operation not permitted, open '<full path>'`. The tab stays dirty, which is right.
- **Where:** The save error handler in `main.js` and `src/app.js`.
- **Why it matters:** "EPERM" means nothing to most people. The long path also fills the note.
- **Fix:** Map the common codes to plain words. `EPERM`/`EACCES`: "x.txt is read-only." `ENOSPC`: "The disk is full." `ENOENT`: "The folder is gone." Offer Save As where it makes sense.

### 6. LOW: a file deleted while open gives no warning

- **What:** Delete an open file in Explorer. Recto says nothing. `Ctrl+S` quietly recreates the file and shows "Saved".
- **Where:** The file watcher in `src/app.js`.
- **Why it matters:** Mostly harmless (nothing is lost). But the user may not know the file moved or was deleted.
- **Fix:** Show a note ("x.txt was deleted outside Recto. Saving will put it back.") and mark the tab.

### 7. LOW: empty states say the wrong thing

- **What:**
  - `Ctrl+P` with no folder open shows "Nothing matches".
  - `Ctrl+Shift+F` with no folder shows "Type at least 2 characters".
  - `Ctrl+F` with no document open does nothing, silently.
- **Where:** Go to file, find in files and find handlers in `src/app.js`.
- **Why it matters:** A new user who hasn't opened a folder is told the search found nothing, when the real problem is that there's nothing to search.
- **Fix:** Show "Open a folder to search its files." Show a flash note for `Ctrl+F` with no document. The sidebar's "Open a folder" link is already good.

### 8. LOW: a missing recent file stays in the list

- **What:** Click a Recent entry whose file has gone. Recto says "File not found." The entry stays, so it fails every time.
- **Where:** Recent list in `src/app.js`.
- **Fix:** Remove the entry when the open fails with "not found".

### 9. LOW: tiny windows are cramped

- **What:** At the minimum size (420 × 300) the sidebar takes 230 px and squeezes the editor. After resizing, the active tab can sit outside the visible part of the tab strip. The path in the status bar is cut off. With 30 tabs the strip scrolls (fine at normal widths).
- **Where:** `main.js` (`minWidth`/`minHeight`) and the sidebar CSS.
- **Fix:** Hide the sidebar by default under about 600 px, and scroll the active tab into view on resize. Or raise the minimum width.

### 10. LOW: some language detection is off

- **What:**
  - A shebang script with no extension shows "Plain text".
  - A `Makefile` shows "Shell".
  - `.gitignore` shows "INI / env".
- **Why it matters:** Wrong label and no highlighting. Cosmetic.
- **Fix:** Read the first line for `#!`, and add filename rules for `Makefile` and `.gitignore`.

### 11. LOW: long path in the status bar

- **What:** The status bar shows the full path on the left. Deep folders get long.
- **Fix:** Show the filename plus the parent folder, with the full path on hover.

## Things worth knowing, read but not run

- `main.js` calls `app.quit()` on the second-instance lock but doesn't `return`, so a few lines of start-up code still run in the second process. In practice the second launch exited cleanly with code 0 and the file opened in the first window. Low risk. Add a `return` when someone is in there.
- SVG files open as pictures, so you can't edit them as text. May surprise people who expect an SVG to be code. A command like "Open as text" would fix it.
- Find in files skips files over 2 MB and caps the number of results. Neither is announced in the dialog.

## Checked and fine

- Binary files are refused with a clear message.
- Empty files, unicode filenames and filenames with special characters all open and save.
- `Esc` on the first-run setup dialog skips it (same as **Skip**).
- Dark theme find and replace render properly.
- Hot exit restores both a dirty file and a dirty untitled tab.
- An outside change to a file with unsaved edits gives a clear note and keeps the edits.
- `Ctrl+Shift+T` reopens a closed tab.
- No console errors seen in any run.
- Install scope: `package.json` has `oneClick: true` and `perMachine: false`, and the right-click entries use `HKCU`. So the "installs for your user only, no admin" claim in the README matches the config. The installer itself was not run.

## Suggested order

1. Items 1 and 2 (small fixes, big effect).
2. The README wording for items 3 and 4 (no code).
3. Item 5, then 7 and 8, as one small "kinder messages" pass.
4. The rest when there's time.
