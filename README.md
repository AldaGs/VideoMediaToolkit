# VideoMediaToolkit (VMT)

![VMT Logo](public/vmtlogo.svg)

**VideoMediaToolkit** is a professional-grade, high-performance desktop application designed for seamless video and image processing. Built with **Electron**, **React**, and **TypeScript**, and powered by the industry-standard **FFmpeg** engine, VMT offers a balance between user-friendly simplicity and powerful advanced control.

---

## 🚀 Features

### 🛠️ Simple Mode: Fast & Efficient

Designed for everyday tasks, Simple Mode provides high-quality results with minimal configuration:

- **Video Compression:** Reduce file sizes while maintaining visual fidelity using H.264, H.265, or VP9.
- **Smart Trimming:** Precise in/out point selection for videos and audio clips.
- **Audio Extraction:** High-quality conversion to MP3, WAV, AAC, or M4A.
- **GIF Conversion:** Generate high-quality GIFs with optimized color palettes (powered by Gifski).
- **Image Conversion:** Batch convert images to PNG, JPG, WebP, and more with resizing options.

### ⚙️ Advanced Mode: Total Control

For power users and professionals who need fine-grained control over the processing pipeline:

- **Custom Codecs:** Full access to all encoders available in the bundled FFmpeg build.
- **Filter Chains:** Apply complex `-vf` (video) and `-af` (audio) filter strings.
- **Command Validation:** Dry-run validation of your custom FFmpeg arguments before starting the real process.
- **Command Preview:** Real-time visibility into the exact FFmpeg command being executed.

### 💾 Preset System

- **Save & Reuse:** Create custom processing profiles for repetitive workflows (e.g., "4K to Twitter", "Lossless Archive").
- **Rename & Manage:** Easily organize your presets directly within the Advanced panel.
- **Automatic Sync:** VMT intelligently detects when you've modified a preset, keeping your workflow transparent.

### 📋 Queue & Batch Processing

- **Multiple Files:** Import dozens of files and process them in sequence.
- **Per-item Settings:** Configure different actions for different items in the queue.
- **Custom Output:** Set individual output paths or process everything to a specific folder.

---

## 💻 Tech Stack

- **Core:** [Electron](https://www.electronjs.org/)
- **Frontend:** [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool:** [Vite](https://vitejs.dev/) + [electron-vite](https://electron-vite.org/)
- **Processing Engine:** [FFmpeg](https://ffmpeg.org/) (Custom builds bundled for Win/Mac)
- **Styling:** Vanilla CSS with a focus on modern glassmorphism and dark aesthetics.

---

## 🛠️ Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/AldaGs/VideoMediaToolkit.git
   cd VideoMediaToolkit
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Add Binaries:**
   The application requires FFmpeg, FFprobe, and Gifski binaries in the `resources/` directory.
   - Place Windows binaries in `resources/win/`
   - Place macOS binaries in `resources/mac/`
     _(Note: These are git-ignored due to size; ensure they are present for local development)._

### Running Locally

```bash
npm run dev
```

### Building for Production

```bash
# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac
```

---

## 🛡️ Security & Performance

- **Sandboxed Renderer:** All file system and heavy processing operations are handled by the Main process via secure IPC.
- **Custom Protocol:** Media files are served via a custom `media://` protocol with full range support, ensuring smooth previewing and seeking without exposing local file paths to the web context.
- **Atomic Writes:** Presets and configuration files use atomic write operations to prevent data corruption.

---

## 📄 License

This project is developed by **Aldair Gonzalez**. All rights reserved.

---

_Warp your media, not your mind. Happy rendering!_
