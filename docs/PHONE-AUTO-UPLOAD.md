# SHIVAM PIXA — Phone Auto-Upload Guide (v3.8.0)

How to get photos from your phone camera into PIXA — from a one-tap share
to a fully automatic Google Photos-style flow.

> Platform note (read this first): **no web app / PWA can silently watch the
> phone gallery in the background** — Android and iOS simply do not give
> browsers that permission. PIXA v3.8.0 therefore ships two mechanisms:
> a one-tap **Share to PIXA** target, and **auto-adoption** of photos that
> any folder-sync app drops into the PIXA Google Drive folder (Route B,
> which is 100% automatic).

---

## Route A — "Share → PIXA" (one tap, works on the phone itself)

What it does: in the phone Gallery you select photo(s) → **Share** →
**PIXA**. The app opens, the photos land in the library under
"Shared from phone", and cloud sync backs them up to Google Drive —
after which every PC shows them at the next poll (≤ 25 s).

Setup (once per phone, Android / Chrome):

1. Open https://utelinor-hub.github.io/shivam-pixa/ in Chrome.
2. Menu (⋮) → **Add to Home screen / Install app**.
3. Sign in to Cloud Sync once (cloud chip → sign in with Google).
4. Done. From now on: Gallery → select photos → Share → **PIXA**.

Technical flow: `manifest.json` declares a `share_target` (POST,
multipart/form-data). The service worker stashes the shared files in a
cache queue (`shivam-pixa-shared-v1`), wakes the app, and the page ingests
them into the library (`receiveShared` in `index.html`).

iOS note: Safari does not support PWA share targets reliably. On iPhone
use Route B instead.

---

## Route B — Fully automatic (no taps, no code)

What it does: you take a photo with the normal camera app → a folder-sync
app uploads it to the **SHIVAM PIXA** folder in Google Drive in the
background → PIXA adopts it automatically (v3.8.0 `adoptExternal` in
`js/cloud.js`) → the photo appears on every PC at the next poll (~25 s)
and in the phone's PIXA too.

Setup (once per phone):

1. Install a folder auto-sync app:
   - **Android:** "Autosync: Google Drive" (MetaCtrl) or "FolderSync"
     — free versions are enough.
   - **iPhone:** "PhotoSync" or the Google Drive app's backup.
2. In the sync app create a pair:
   - Local folder: `/storage/emulated/0/DCIM/Camera` (the camera folder)
   - Remote folder: Google Drive → **SHIVAM PIXA**
     (the same folder PIXA creates; it sits at the Drive root)
   - Direction: upload only (one-way). Schedule: whenever new files appear.
3. That's it. No PIXA changes are needed — at every pull PIXA lists the
   Drive folder and adopts image files it did not file yet
   (they show up grouped as "Phone & other uploads").

Adoption rules (so nothing ever duplicates):

- Files PIXA itself uploaded carry an internal `pixa` property and are
  never re-adopted.
- `*.thumb.jpg` companions and the `pixa-manifest.json` are ignored.
- Deleting an adopted photo in PIXA also trashes the Drive file, so it
  will not come back at the next pull.

---

## Route C — Companion Android app (the Google-Photos way, future)

A tiny Kotlin app with a `MediaStore` ContentObserver could upload new
camera photos itself (same Drive folder, same OAuth `drive.file` scope)
with zero third-party apps. Route B delivers the same result today with
no code — build Route C only if you want the app published under your
own name.

---

## Quick check-list

| Symptom | Fix |
| --- | --- |
| "PIXA" not in the Android share sheet | Install the PWA first (step A2), then reboot the phone once |
| Shared photos don't appear | Open PIXA once on the phone and make sure Cloud Sync shows green |
| Autosync photos don't show on PC | Check the target folder is exactly "SHIVAM PIXA" at the Drive root; press the cloud chip → "Sync now" |
| Photos arrive but look HEIC/RAW | Convert to JPG first — PIXA (like the local importer) skips HEIC/RAW |
