# InDiskitive: Microsoft Store listing kit

Copy and paste each block into Partner Center.

## Product identity (from Partner Center, needed by build-msix.ps1)
Partner Center > your app > Product management > Product identity. Copy:
- Package/Identity/Name  -> `-IdentityName`
- Package/Identity/Publisher  (starts with `CN=`) -> `-Publisher`
- Package/Properties/PublisherDisplayName -> `-PublisherDisplayName`

```powershell
.\store\build-msix.ps1 -IdentityName "<Name>" -Publisher "<CN=...>" -PublisherDisplayName "<display name>"
```
Output: `store\out\InDiskitive_0.1.0.0_x64.msix`. Upload that file as-is (unsigned is correct; the Store signs it).
Each new submission needs a higher `-Version` (keep the last part 0, e.g. 0.1.1.0).

## Properties
- Category: Utilities & tools (sub-category: File management)
- Price: Free
- Markets: all
- Age rating questionnaire: answer No to everything (no user content, no network, no purchases). Result: 3+/Everyone.
- Privacy policy URL: not required for an app that collects nothing and uses no network. If the form insists, use the text at the bottom, hosted anywhere public.

## Name
InDiskitive

## Short description (max 100 chars)
See where your disk space went. Fast treemap disk usage viewer.

## Description
InDiskitive shows what is using your disk space, fast. Pick a drive and see every folder and file as a treemap, sized by what it takes up.

- Scan a whole drive in seconds. With administrator rights it reads the NTFS file table directly.
- Switch between drives instantly. Finished scans are kept until you refresh.
- Type "free 120gb" and get a few short lists of what to clear: the fewest items that cover the amount, safe-to-delete caches, whole game folders, and more.
- Games and big folders are suggested as a whole, never as half-deleted pieces.
- Everything stays on your PC. InDiskitive never deletes anything and never connects to the internet.

## Features (bullets, up to 20)
- Treemap of your whole drive
- Fast NTFS scan with administrator rights
- Instant switching between scanned drives
- "Free N GB" planner with safe options
- Whole-folder suggestions for games and projects
- Command line: free, scan, cd, up, refresh
- Read-only: never deletes files
- No account, no ads, no network

## Search keywords (max 7)
disk usage, disk space, treemap, storage, cleanup, folder size, free space

## What's new in this version (release notes)
First release.

## Screenshots (required: at least 1; use 1366x768 or larger, PNG)
Ready-made shots are in docs/screenshots. To retake them, use a test folder you are happy to show:
1. Treemap after scanning a drive.
2. The Free panel after typing `free 20gb` (shows the options).
3. The start screen with the volume list.
Win+Shift+S, then save PNGs.

## Store logo / images
Partner Center asks for a 300x300 app tile (and optionally 1080x1080 / 2160x2160 art). Use `src-tauri\icons\icon.png` (resize if it complains).

## Notes for certification (paste into "Notes for certification")
InDiskitive is a local disk-usage viewer. It reads file and folder names and sizes from the user's drives to draw a treemap. It does not modify or delete files and has no network access. Administrator rights are optional: when the user runs the app as administrator it reads the NTFS Master File Table from the volume for a faster scan; without administrator rights it uses a normal directory walk. No sign-in is needed to test: launch, click a drive, wait for the scan, then type "free 20gb" in the command line.

## Justification for the restricted capability runFullTrust
The app is a Win32 desktop program (Tauri/Rust with the system WebView2) that must enumerate the whole file system and, optionally with administrator rights, read the NTFS volume. These are not possible from a sandboxed UWP app, so it is packaged as a full-trust desktop app.

## Privacy statement (only if a URL is demanded)
InDiskitive does not collect, store, or transmit any personal information. It runs entirely on your device and does not connect to the internet. File and folder names and sizes are read locally to display disk usage and are never sent anywhere. Contact: <your support email>
