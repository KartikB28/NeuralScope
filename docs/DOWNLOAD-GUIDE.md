# NeuralScope — Download & Install Guide

Getting NeuralScope onto your machine takes about two minutes. There is no
account to create, nothing to configure, and no internet connection required
to use it — it works the moment it opens.

---

## 1. Pick your download

Go to the **[Releases page](../../releases)** and download the one file for
your operating system:

| Your computer | Download this file |
|---|---|
| **Windows** (10 or 11) | `NeuralScope-0.1.0-win-x64.exe` |
| **Mac** (Apple Silicon — M1/M2/M3/M4) | `NeuralScope-0.1.0-mac-arm64.dmg` |
| **Mac** (older Intel Macs) | `NeuralScope-0.1.0-mac-x64.dmg` |
| **Linux** (most distributions) | `NeuralScope-0.1.0-linux-x86_64.AppImage` |
| **Linux** (Debian / Ubuntu) | `NeuralScope-0.1.0-linux-amd64.deb` |

> Not sure which Mac you have? Click the Apple menu →  About This Mac. If it
> says "Apple M1/M2/M3/M4", use **arm64**. If it says "Intel", use **x64**.

---

## 2. Install it

### Windows
1. Double-click the `.exe`.
2. Windows may show a blue **"Windows protected your PC"** box. This appears
   for any app that isn't from a big paid publisher — it does not mean
   anything is wrong. Click **More info → Run anyway**.
3. It installs in a few seconds and opens itself. A Start-menu shortcut and a
   desktop icon are created.

### Mac
1. Double-click the `.dmg`, then drag **NeuralScope** into your **Applications**
   folder.
2. The first time you open it, macOS will say the app is from an
   "unidentified developer" (because it isn't signed with a paid Apple
   certificate yet). To open it anyway:
   - **Right-click** (or Control-click) the NeuralScope icon → **Open** →
     **Open** again in the dialog. You only do this once.
   - If you don't see an Open button: open **System Settings → Privacy &
     Security**, scroll down, and click **Open Anyway** next to the
     NeuralScope message.

### Linux
- **AppImage:** make it executable and run it.
  ```bash
  chmod +x NeuralScope-0.1.0-linux-x86_64.AppImage
  ./NeuralScope-0.1.0-linux-x86_64.AppImage
  ```
- **.deb:** install it with your package manager.
  ```bash
  sudo apt install ./NeuralScope-0.1.0-linux-amd64.deb
  ```

> These builds are not yet code-signed or notarized, which is why each OS
> shows a one-time "unknown publisher" prompt. That is expected for an
> independent v0.1 release — signing is on the roadmap.

---

## 3. First launch

NeuralScope opens straight into its 3D world with a short welcome card. **It
already works** — fully offline, on a built-in demo engine, with no keys and
no setup. Type an objective in the bar at the bottom (or press the ✦ button
for examples) and watch it run.

When you're ready for real AI horsepower, see **step 5** below — but you can
explore everything first without it.

---

## 4. Where your data lives

Everything NeuralScope creates is stored in one folder you own:

| Operating system | Folder |
|---|---|
| Windows | `C:\Users\<you>\.neuralscope` |
| Mac | `/Users/<you>/.neuralscope` |
| Linux | `/home/<you>/.neuralscope` |

Inside it: your skills, your memory, the "black box" event log, and the files
every objective produces (under `workspaces/`). Nothing is sent anywhere.
Delete this folder and the app is factory-new. (Settings → DATA has an "open
folder" button on the desktop app.)

---

## 5. Optional: give it real models

The demo engine proves how everything works; real models do real work. Open
**SETTINGS** in the top bar:

- **Free & private — local models:** install [Ollama](https://ollama.com),
  then in a terminal run `ollama pull llama3.2` (and `ollama pull
  qwen2.5-coder` for better website builds). NeuralScope detects it
  automatically — no configuration.
- **Most capable — a frontier model:** paste an **Anthropic API key**
  (from console.anthropic.com). It is stored encrypted on your machine and
  is only ever sent to Anthropic's API — never shown on screen, never put
  inside the work prompts.

You can use both at once (a frontier model for planning, local models for the
grunt work). The app works identically with or without them — better models
just produce better results.

---

## 6. Uninstall

- **Windows:** Settings → Apps → NeuralScope → Uninstall.
- **Mac:** drag NeuralScope from Applications to the Trash.
- **Linux:** delete the AppImage, or `sudo apt remove neuralscope`.

To also erase everything it created, delete the `.neuralscope` folder
(step 4). Your API keys live only inside it, so removing it removes them.

---

## Run from source (for developers)

```bash
git clone https://github.com/KartikB28/NeuralScope
cd NeuralScope
npm install
npm run build
npm run app          # the desktop app
# — or run it headless and open the printed URL in any browser: —
npm run engine       # http://127.0.0.1:43117
```

`npm run dist` packages an installer for your current OS into `release/`.
See **[OPERATING-MANUAL.md](OPERATING-MANUAL.md)** to learn the interface and
**[FEATURES.md](FEATURES.md)** for everything it can do.
