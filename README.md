# VideoMediaToolkit (VMT)

![VMT Logo](public/vmtlogo.svg = 200x200)

**VideoMediaToolkit** is a professional-grade, high-performance desktop application designed for seamless video and image processing. Built with **Electron**, **React**, and **TypeScript**, and powered by the industry-standard **FFmpeg** engine, VMT offers a perfect balance between user-friendly simplicity and powerful advanced control.

---

## 🚀 Key Features

### 🎞️ Professional Codec Support
VMT is built for high-end production workflows, supporting specialized codecs that many standard converters can't handle:
- **Apple ProRes:** Full support for Proxy, LT, 422, HQ, 4444, and 4444XQ.
- **HAP Suite:** High-performance playback for media servers (HAP, HAP Alpha, HAP Q).
- **Transparency (Alpha):** Support for HEVC (with Alpha), VP9 (with Alpha), and HAP Alpha.
- **High Bit-Depth:** 10-bit and 12-bit encoding support for professional masters.

### 📋 Smart Queue & Batch Processing
Efficiently manage large projects with our revamped processing engine:
- **Multi-Selection:** Select and process dozens of files simultaneously.
- **Per-Item Configuration:** Set individual output paths and settings for every item in your queue.
- **Intelligent Auto-Select:** VMT automatically switches between Video and Image modes based on the selected file.
- **Status Tracking:** Real-time progress bars and status indicators for every item in the queue.

### ⚡ Smart Preview Engine
Professional codecs (like HAP and ProRes) are often unplayable in standard web views. VMT solves this with a built-in Proxy Engine:
- **Automatic Proxies:** VMT detects unplayable codecs and generates high-performance H.264 proxies in the background.
- **Zero Latency:** Seamlessly preview and scrub through professional footage without lag.
- **Custom Protocol:** Media is served via a secure `media://` protocol with full Range support for instant seeking.

### 🖼️ Advanced Image Conversion
No longer reliant on external tools like ImageMagick. VMT uses FFmpeg for all image operations:
- **Modern Formats:** Convert to WebP, PNG, JPG, and more.
- **Quality Control:** Fine-tune compression levels and metadata retention.
- **Batch Resizing:** Maintain aspect ratios or force custom dimensions across entire image sets.

### ⚙️ Advanced Mode: Total Control
For power users who need exact control over the processing pipeline:
- **Command Validation:** Dry-run your FFmpeg commands to catch errors before starting long renders.
- **Command Preview:** See the exact string being sent to the engine in real-time.
- **Dynamic Capabilities:** VMT automatically detects your bundled FFmpeg's encoders, decoders, and supported formats.
- **Preset System:** Save, rename, and manage custom processing profiles with atomic write protection.

---

## 💻 Tech Stack

- **Core:** [Electron](https://www.electronjs.org/)
- **Frontend:** [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool:** [Vite](https://vitejs.dev/) + [electron-vite](https://electron-vite.org/)
- **Processing Engine:** [FFmpeg](https://ffmpeg.org/) (Custom builds bundled for Win/Mac)
- **GIF Optimization:** [Gifski](https://gif.ski/) (High-quality, piped integration)
- **Styling:** Vanilla CSS with modern Glassmorphism, Dark Mode, and Resizable Panels.

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
- **Media Proxy:** High-performance local file streaming via the `media://` protocol avoids disabling standard web security features.
- **Atomic Writes:** Presets and configuration files use atomic write operations (`rename`) to prevent data corruption during crashes.
- **Pipe Integration:** GIF generation uses direct OS pipes between FFmpeg and Gifski to minimize disk I/O and maximize speed.

---

## 📄 License

This project is developed by **Aldair Gonzalez**. All rights reserved.

---

_Warp your media, not your mind. Happy rendering!_
