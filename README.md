# Expense log

A small phone app for logging each expense in a few taps, right after you pay. Entries go into a
separate Google Sheet called **Expense Inbox**. Your master expenditure sheet is never touched: when
you sit at your laptop you copy a day from the Inbox into the master sheet, then clear the Inbox.

This file explains what the app does and how to set everything up again from scratch.

---

## 1. What the app does

```
Phone app (installed from GitHub Pages)  ──POST + token──▶  Apps Script web app  ──writes──▶  Expense Inbox sheet
   works offline, has Settings                               (lives inside that sheet)         Inbox | Lists | By day
```

| Piece | What it is | Where it lives |
|---|---|---|
| Phone app | A web app (PWA) you install on the home screen. Works with no signal and uploads later. | GitHub Pages, personal GitHub account |
| Backend | A Google Apps Script web app. Receives entries, writes rows, formats the sheet. | Inside the Expense Inbox sheet (Extensions → Apps Script) |
| Expense Inbox | A Google Sheet with three tabs: **Inbox** (one row per entry), **Lists** (your Apps, Accounts, Items), **By day** (one row per date, ready to copy). | Personal Google account |

**What you can do in the app**

- Enter an amount (the **+** key adds sums such as `50+40+30`), an item, an App and an Account, and a date (Today, Yesterday, or any date).
- App and Account are optional. They start at the top entry of their lists. **×** clears one, **Other…** lets you type a one-off value (tick *Add to list* to keep it).
- Item suggestions appear while you type. New items are remembered automatically.
- Tick **Bill payment (not counted as an expense)** for credit card bills. They are written in parentheses and are not added to the day's total.
- **Nothing today** logs a day with no spending.
- The last 5 entries are listed, each with an **edit** (pencil) and a **delete** button.
- **Edit** opens the entry in the main form (a banner says "Editing the entry from …" with a **Cancel** button, and **Save** becomes **Update**). **Update** changes the entry in place in the Inbox: same row, same ID, same *Logged at*. By day refreshes by itself.
- **Settings (⚙)**: add, remove and reorder Apps and Accounts (the top entry is the default), see the connection, run **Sync now**, see the app version.
- After **Save** you see `Saving for Sat, 14 Nov…`, then `Saved for Sat, 14 Nov ✓`. With no signal you see `Saved on this phone for … Will upload when online.`

**What the sheet does for you**

- **Line** column: your entry written exactly as in the master sheet, e.g. `Petrol (CRED, Indus CC): 250`. Blank parts are left out. A sum shows as `50 + 40 + 30 = 120`. A bill payment is `(Item (App, Account): amount)`.
- **By day** tab: for each date, the lines joined with a blank line between them, one blank line above the first and below the last, and the total of the entries that count as expenses. Bill payments go at the bottom and are blue (`#1155CC`, the same blue as the master sheet). A date with only "Nothing" shows `Nothing` and 0.
- By day holds real text (not formulas), so copying its cells into the master sheet keeps the blue lines and the formatting.
- Formatting matches the master sheet: Arial 10, vertical middle, thin black borders. Everything is centred except **Line** (Inbox) and **Detailed Expenditure** (By day), which are left aligned and wrapped. In the Inbox, a bill payment row is blue.

---

## 2. What is in this folder

| Path | What it is |
|---|---|
| `web/` | The phone app. These files are what you upload to GitHub. |
| `apps_script/Code.gs` | The backend. You paste it into the Expense Inbox script editor. |
| `apps_script/appsscript.json` | Optional settings file (time zone, web app access). |
| `tools/make_link.py` | Builds the one-time setup link for the phone. |
| `tests/` | Automated tests, and a local dev server (see section 10). |

---

## 3. Which parts do I need to redo?

| Situation | Do these parts |
|---|---|
| Everything is lost | Parts A, B, C, D in order |
| Only the phone is new or the app was uninstalled | Part C (you need the web app URL and the token; `showToken` in the script editor prints the token) |
| Only the GitHub site is gone | Part B, then Part C |
| Only a new Google Sheet is needed | Part A, then Part C (new URL and new token) |

## 4. Before you start

- Your **personal** Google account, and your **personal** GitHub account. Do not use the work accounts.
- Sign in to the personal Google account in a separate Chrome profile or a private window. If two Google accounts are signed in at once, Google adds `/u/1/` to links and the web app URL then fails (see section 8).
- On this laptop, `gh` is logged in to the **work** GitHub account, so do the GitHub part in the browser, not with `gh` or `git push`.
- An Android phone with Chrome. `python3` on the laptop for `tools/make_link.py` (or build the link by hand, see C1).

---

## 5. Setup from scratch

### Part A. Google side: the sheet and the backend

**A1. Create the sheet**
1. In your personal Google account, open Google Sheets and create a blank spreadsheet.
2. Name it **Expense Inbox**.

**A2. Add the backend code**
1. In that sheet open **Extensions → Apps Script**.
2. Delete the sample code in the editor.
3. Open `apps_script/Code.gs` on your laptop, copy **all of it**, and paste it into the editor.
4. Check that the very first line is `/** @OnlyCurrentDoc */`. It limits Google's permission request to this one spreadsheet.
5. Press **Ctrl+S**.
6. Optional: in **Project Settings** (gear icon) tick *Show "appsscript.json" manifest file in editor*, go back to **Editor**, open `appsscript.json`, and paste the contents of `apps_script/appsscript.json`.

**A3. Run `setup` once**
1. In the toolbar, use the function dropdown (next to **Debug**) and pick **`setup`**.
2. Click **▶ Run**.
3. On the permission screens:
   - **Review permissions**, then choose your **personal** account.
   - **Google hasn't verified this app**: click **Advanced**, then **Go to Untitled project (unsafe)**. This only means Google has not reviewed your private script.
   - The permission list should say it can see and edit **only the spreadsheet this script is bound to**. Click **Allow**. If it says "all your Google Sheets", the first line of `Code.gs` is missing: cancel, fix it, save, and run again.
4. In the **Execution log** at the bottom, find `Setup done. Your token is: …` and copy the 24-character token. Keep it somewhere private. You can print it again any time by running **`showToken`**.
5. Look at the spreadsheet: it now has the tabs **Inbox**, **Lists** and **By day**.

Running `setup` again later is safe: it keeps your token, your lists and your entries, and only re-applies the formatting and rebuilds By day.

**A4. Publish the backend as a web app**
1. Click **Deploy → New deployment**.
2. Click the gear icon next to *Select type* and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. It must be *Anyone*, because the phone app does not sign in to Google. The token is what keeps other people out.
4. Click **Deploy** (approve permissions if asked) and copy the **Web app URL**.
5. Make sure the URL looks like `https://script.google.com/macros/s/AKfy…/exec` and has **no `/u/1/`** in it. If it does, delete `u/1/` from the address.
6. Paste the URL into a browser. You should see:
   `{"ok":true,"message":"Expense Inbox is running. Use the app to log entries."}`

### Part B. Publish the phone app on GitHub Pages

1. Sign in to GitHub in the browser with your **personal** account (a private window avoids mixing accounts).
2. Click **+ → New repository**. Name: `expense-log`. Visibility: **Public** (free Pages needs it; the repo holds only app files, no token and no data). Leave the other options unticked and click **Create repository**.
3. Click **uploading an existing file**.
4. On your laptop, open `~/Documents/expense_app/web/` and select **everything inside it**: `app.js`, `index.html`, `line.js`, `manifest.webmanifest`, `style.css`, `sw.js` and the `icons` folder. Drag them into the browser window. Check that `icons/icon-192.png` and `icons/icon-512.png` are in the list.
5. Click **Commit changes**.
6. Open **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
7. After about a minute the Pages screen shows the address: `https://<your-username>.github.io/expense-log/`. Open it: you should see a **Connect** screen.

### Part C. Connect and install on the phone

**C1. Build the setup link** (on the laptop, in this folder)
```
python3 tools/make_link.py https://<your-username>.github.io/expense-log/ "<Web app URL>" <token>
```
Keep the quotes around the URL. It prints one long link that starts with your Pages address and contains `#u=…&t=…`. Treat it like a password, because it contains the token.

By hand, the link is `<Pages address>#u=<web app URL, URL-encoded>&t=<token>`.

**C2. Open it on the phone**
1. Send the link to yourself privately (Google Keep, WhatsApp "message yourself", or email).
2. Open it in **Chrome** on the phone. The app opens on the main form with **CRED** and **Indus CC** selected, and the `#…` part disappears from the address bar.
3. Chrome menu **⋮ → Install app** (or *Add to Home screen*).
4. Open the app from the new home-screen icon. In **⚙ Settings** the bottom line shows the app version.

If you prefer not to use a link: on the **Connect** screen paste the web app URL and the token by hand.

### Part D. Check that it works

1. Log `250`, item `Petrol`, and tap **Save**. You see `Saving for …`, then `Saved for … ✓`, and the top shows **✓ synced**.
2. In the Inbox tab a row appears with `Petrol (CRED, Indus CC): 250`.
3. Log a second entry with **Yesterday**, tick *Bill payment* on a third, and tap **Nothing today** for an empty date.
4. Open **By day** and check the dates, the joined lines, the blue bill line at the bottom, and the totals.
5. Offline check: switch on airplane mode, log an entry (the top shows `1 waiting`), switch it off, and see it upload once.
6. Delete the test rows from **Inbox** (select the rows, right-click, *Delete rows*).

---

## 6. Daily use

1. Type the amount. Close the keyboard when you are done typing (the Save button sits at the bottom of the screen, so it is hidden while the keyboard is open).
2. Type the item, or tap a suggestion.
3. Change App, Account or Date only if they differ from the defaults.
4. Tap **Save**. The page stays where it is, so you can see the confirmation.

**Fixing an entry**
1. In **Last 5 entries**, tap the pencil next to the entry. The page moves to the top and the form fills with that entry (a sum such as `50+40+30` shows as typed).
2. Change what is wrong (amount, item, App, Account, date, the bill-payment tick) and tap **Update**. **Cancel** leaves the entry as it was.
3. Entries that are still waiting to upload can be edited with no signal. An entry that has already uploaded needs a connection; if there is none you see `Could not update…` and the form stays open, so tap **Update** again later.
4. **Nothing** entries have no pencil: delete one and add it again.
5. Only the last 5 entries can be edited in the app. For older ones, edit the Inbox row in the sheet by hand (By day follows the edit).
6. The Line is rebuilt from the fields, so a Line you edited by hand in the sheet is replaced when you update that entry in the app.

**Moving entries to the master sheet**
1. Open **By day** in the Expense Inbox.
2. For a day, select its *Detailed Expenditure* and *Total Expenditure* cells (two neighbouring cells) and copy them with **Ctrl+C**.
3. Paste with **Ctrl+V** onto the same two cells of that day in the 2026 tab. Use a normal paste: "Paste values only" drops the colours.
4. If the master cell already has entries, a paste replaces them. In that case append the new lines by hand instead.
5. When everything is moved, delete the data rows of **Inbox** (keep the header row). Leave the **Lists** tab alone.

By day is rewritten by the script after every phone save or delete, whenever you edit a cell in the Inbox, and every time you open the sheet. The menu **Expense Inbox → Refresh By day** does it on demand. Do not type into By day: your changes are overwritten. If you edit a Line cell by hand, By day uses the edited text, but its total still comes from the Amount column.

---

## 7. Updating later

**The phone app (`web/` files)**
1. Edit the files. If the change is a release, raise `VERSION` in `web/app.js` and the cache name in `web/sw.js` (`expense-log-vN`) together, by the same number.
2. In your GitHub repo open each changed file, click the **pencil**, paste the new content, and commit (or use *Add file → Upload files* to replace files).
3. The phone fetches the new version the next time the app is open with signal and reloads itself once (it waits if an entry is half typed). Settings shows the version number so you can confirm.

**The backend (`Code.gs`)**

If a release changes both the backend and the app, update the **backend first**, then the app files. An app that is newer than its backend shows errors (for example `unknown action`) until the backend is redeployed.

1. Paste the new `Code.gs` over the old code in the script editor and press **Ctrl+S**.
2. Run **`setup`** once.
3. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.** The URL stays the same. Without this step, entries saved from the phone still use the old code.

**The Line logic** exists in two files that must stay identical: `web/line.js` and the marked block in `apps_script/Code.gs`. `node tests/check_sync.js` checks this.

**Token lost or leaked:** run **`rotateToken`** in the script editor, then enter the new token in the phone's Settings (or build a new setup link).

---

## 8. If something goes wrong

| What you see | Cause and fix |
|---|---|
| Opening the web app URL shows Google Drive: "Sorry, unable to open the file at present" | The URL contains `/u/1/` (two Google accounts signed in), or access is not *Anyone*. Delete `u/1/` from the address. Otherwise open **Deploy → Manage deployments → pencil**, set *Anyone*, choose **New version**, **Deploy**. |
| The permission screen says "all your Google Sheets" | `/** @OnlyCurrentDoc */` is missing from line 1 of `Code.gs`. |
| Phone still shows the old app after an upload | Swipe the app away from recent apps and open it, twice. If it still shows the old one: first check the top says **✓ synced** (so nothing is waiting), then Chrome **⋮ → Settings → Site settings → All sites → your github.io address → Clear & reset**, and open the setup link again. |
| `Token rejected. Check Settings.` | The token on the phone differs from the script's. Run `showToken` and compare, or run `rotateToken` and enter the new one in Settings. |
| The top shows `N waiting` or `not synced` | No signal or the backend is unreachable. Open Settings → **Sync now**. Check that the web app URL opens in a browser and shows the `ok` message. Waiting entries are kept on the phone. |
| `Could not update. Check your connection…` | The edit could not reach the server. Nothing was changed; the form stays open. Fix the connection and tap **Update** again. |
| `Could not update: unknown action` | The backend has not been redeployed since the last `Code.gs` change. **Deploy → Manage deployments → New version.** |
| `1 entry rejected by the server: …` | The server refused that entry (for example a bad amount). Enter it again. |
| Entries from the phone are not formatted or By day is not updated, but edits in the sheet are | `Code.gs` was changed but the web app was not redeployed. **Deploy → Manage deployments → New version.** |
| By day still shows a day after you deleted its rows by hand | Deleting rows does not trigger a refresh. Reopen the sheet, use **Expense Inbox → Refresh By day**, or log the next entry. |
| The blue disappears when pasting into the master sheet | You used "Paste values only". Use a plain **Ctrl+V** of the cells. |
| The Save button is hidden | The keyboard is open. Close it. |

---

## 9. Security and privacy

- The GitHub repo is public but contains only the app files. The token and your web app URL never appear in it. They are stored on the phone (and the token in the script's private properties).
- The web app is open to anyone who has its URL, but every request needs the token, otherwise it answers `unauthorized`.
- The script's permission is limited to the Expense Inbox spreadsheet.
- The setup link contains the token. Delete the message you sent to yourself once the phone is connected.

## 10. Tests (for changes to the code)

```
node tests/check_sync.js                     # Line logic identical in app and backend
node tests/test_line.js                      # Line format and amount parsing
node tests/test_backend.js                   # real Code.gs against an in-memory spreadsheet
node tests/dev_server.js 8123 &              # local copy of the whole system, nothing saved anywhere
python3 tests/e2e_ui.py                      # real Chrome drives the app (needs Chrome + playwright)
python3 tests/e2e_update.py                  # checks that a new app version installs itself
```

`node tests/dev_server.js` on its own prints a link you can open in a browser to try the app without any Google account. The tests cannot check Google's own rendering (colours, borders) or the paste into the master sheet; Part D and a test paste do that.

## 11. Current deployment (for reference)

| Item | Value |
|---|---|
| App address | https://vrb1995.github.io/expense-log/ |
| Expense Inbox sheet | https://docs.google.com/spreadsheets/d/160YAizglAQzIzVDR1lO_3m7cqFVvGNS0HUV622ySJEY/edit |
| Web app URL | Script editor → **Deploy → Manage deployments** |
| Token | Not stored here. Script editor → run `showToken` |
