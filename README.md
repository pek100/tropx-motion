# TropX Motion - Real-time Motion Capture Application

Real-time motion capture application using TropX IMU sensors with BLE connectivity and WebSocket streaming.

## 🚀 Quick Start

### Desktop (Windows/Mac/Linux)

```bash
# Install dependencies
npm install

# Build and run (auto-detects your platform)
npm start
```

**That's it!** The app automatically detects your platform and applies optimal settings.

### Raspberry Pi

See **[RPIPORT.md](RPIPORT.md)** for complete Raspberry Pi setup guide.

**Quick install:**
```bash
npm install
npm run build
npm start
```

The smart launcher detects Raspberry Pi and applies optimizations automatically.

---

## 📦 Available Scripts

### Development

- `npm run dev` - Start development mode with hot reload
- `npm run dev:manual` - Build main + start dev server (manual Electron launch)
- `npm run dev:main` - Watch main process (TypeScript)
- `npm run dev:renderer` - Start Vite dev server (React UI)

### Building

- `npm run build` - Build both main and renderer processes
- `npm run build:main` - Build main process only
- `npm run build:renderer` - Build renderer (UI) only
- `npm run build:pi` - Build for Raspberry Pi

### Running

- `npm start` - **Smart launcher** (auto-detects platform, applies optimizations)
- `npm run start:smart` - Same as `npm start`
- `npm run start:electron` - Launch Electron directly (no optimizations)
- `npm run start:pi` - Launch with Raspberry Pi optimizations
- `./start.sh` - Smart launcher (Linux/Mac shell script)

### Packaging

- `npm run package:win` - Package for Windows (NSIS installer)
- `npm run package:win:portable` - Portable Windows executable
- `npm run package:mac` - Package for macOS (DMG)
- `npm run package:mac:portable` - macOS ZIP archive
- `npm run package:linux` - Package for Linux (AppImage)
- `npm run package:linux-arm64` - Package for ARM64 Linux
- `npm run package:pi` - Package for Raspberry Pi (ARM64 AppImage)

### Utilities

- `npm run clean` - Remove build artifacts
- `npm run postinstall` - Install Electron dependencies (runs automatically)

---

## 🖥️ Platform Support

### Desktop Systems

| Platform | Status | Auto-Optimization |
|----------|--------|-------------------|
| **Windows 10/11** | ✅ Fully Supported | ✅ Automatic |
| **macOS** (Intel/Apple Silicon) | ✅ Fully Supported | ✅ Automatic |
| **Linux** (Ubuntu, Debian, etc.) | ✅ Fully Supported | ✅ Automatic |

**Desktop systems automatically use:**
- Full GPU acceleration
- Smooth animations
- Large memory heap (1-2GB)
- Support for 8+ devices simultaneously

### Raspberry Pi

| Model | RAM | Status | Performance |
|-------|-----|--------|-------------|
| **Pi 3B** | 1GB | ⚠️ Minimum | Laggy but functional |
| **Pi 4** | 4GB | ✅ Good | Smooth operation |
| **Pi 5** | 4GB/8GB | ✅✅ Excellent | Desktop-like experience |

**Raspberry Pi automatically uses:**
- Optimized memory limits
- Disabled GPU acceleration (Pi 3B/4)
- Reduced animations
- Limited devices (2 for Pi 3B, 4+ for Pi 4/5)
- zram compression (if installed)

See **[RPIPORT.md](RPIPORT.md)** for detailed Pi setup.

---

## 🔧 Features

### Core Functionality

- **Real-time BLE connectivity** with TropX IMU sensors (100Hz quaternion data)
- **Hardware clock synchronization** (sub-millisecond accuracy)
- **WebSocket bridge** for real-time UI updates
- **Binary protocol** for efficient data transfer (79% size reduction)
- **Motion processing** with async algorithms (non-blocking)
- **Recording & playback** with timestamp sync
- **Device locate mode** (shake to find)

### Smart Platform Detection

The app automatically detects:
- Platform type (Windows/Mac/Linux/Raspberry Pi)
- Available RAM
- CPU count
- Raspberry Pi model (if applicable)

And applies optimal settings:
- Memory limits
- GPU acceleration (on/off)
- Animation quality
- Chart update rates
- Maximum device count

---

## 🔌 ESP32 Serial Integration (Optional)

The app includes automatic ESP32 serial port detection for passing motion data to external microcontrollers.

**How it works:**
1. Connect ESP32 via USB or GPIO UART
2. App auto-detects serial port (cross-platform)
3. Motion data streams at 100Hz in binary format

**See RPIPORT.md** for ESP32 wiring and code examples.

---

## 📊 Architecture

```
┌─────────────────────────────────────────────┐
│        Electron Main Process (Node.js)      │
├─────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────────┐   │
│  │ Platform     │   │ Serial Port      │   │
│  │ Detector     │   │ Detector (ESP32) │   │
│  └──────────────┘   └──────────────────┘   │
│  ┌──────────────────────────────────────┐  │
│  │   Noble BLE Service                  │  │
│  │   - Device scanning & connection     │  │
│  │   - Quaternion data parsing (100Hz)  │  │
│  │   - Hardware clock sync              │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │   Motion Processing Coordinator      │  │
│  │   - Async data parsing               │  │
│  │   - Joint angle calculations         │  │
│  │   - Recording management             │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │   Unified WebSocket Bridge           │  │
│  │   - Binary protocol streaming        │  │
│  │   - Domain-based message routing     │  │
│  │   - Connection management            │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
                    ↕ IPC
┌─────────────────────────────────────────────┐
│      Electron Renderer Process (Browser)    │
├─────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │   React UI (Vite + TypeScript)       │  │
│  │   - Device management UI             │  │
│  │   - Real-time chart (Recharts)       │  │
│  │   - Recording controls               │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │   WebSocket Client (TropxWSClient)   │  │
│  │   - Auto-reconnect                   │  │
│  │   - Binary protocol deserialization  │  │
│  │   - Event handling                   │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## 🛠️ Development

### Prerequisites

- **Node.js** 22.x or higher
- **npm** 10.x or higher
- **Bluetooth** adapter (for BLE)
- **Git**

### First-time Setup

```bash
# Clone repository
git clone <repo-url>
cd tropxmotion

# Install dependencies
npm install

# Build project
npm run build

# Run app
npm start
```

### Development Workflow

```bash
# Terminal 1: Build main process (watches for changes)
npm run dev:main

# Terminal 2: Start Vite dev server (hot reload)
npm run dev:renderer

# Terminal 3: Launch Electron (restart manually when main changes)
npm run start:electron
```

### Project Structure

```
tropxmotion/
├── electron/
│   ├── main/           # Electron main process
│   ├── preload/        # Preload scripts (IPC bridge)
│   └── renderer/       # React UI (Vite)
│       └── src/
│           ├── components/    # UI components
│           ├── hooks/         # React hooks (WebSocket, etc.)
│           └── lib/           # WebSocket client
├── ble-bridge/         # Noble BLE integration
├── websocket-bridge/   # WebSocket server
├── motionProcessing/   # Motion data processing
├── registry-management/ # Device registry
├── shared/             # Shared utilities
│   ├── PlatformDetector.ts   # Platform detection
│   └── SerialPortDetector.ts # ESP32 auto-detect
├── scripts/
│   └── start-smart.js  # Smart launcher
├── start.sh            # Linux/Mac launcher
├── RPIPORT.md          # Raspberry Pi guide
└── package.json
```

---

## 🐛 Troubleshooting

### Desktop Issues

**App won't start:**
```bash
# Clear build cache
npm run clean
npm run build
npm start
```

**BLE devices not found:**
- Check Bluetooth is enabled
- Grant Bluetooth permissions (macOS/Windows)
- Install drivers if needed (Windows)

**High memory usage:**
- Normal for Electron (~500-700MB)
- Close other apps if needed

### Raspberry Pi Issues

**See [RPIPORT.md](RPIPORT.md)** for comprehensive Pi troubleshooting.

**Quick fixes:**
```bash
# Out of memory
sudo systemctl restart zramswap

# BLE issues
sudo systemctl restart bluetooth

# Slow startup
# Normal on Pi 3B - wait 60-90 seconds
```

---

## 📚 Documentation

- **[RPIPORT.md](RPIPORT.md)** - Complete Raspberry Pi installation and optimization guide
- **[PROJECTFLOW.md](PROJECTFLOW.md)** - Architecture deep-dive and data flow

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🆘 Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check [RPIPORT.md](RPIPORT.md) for Pi-specific problems
- Review [PROJECTFLOW.md](PROJECTFLOW.md) for architecture questions

---

**Built with ❤️ for motion capture research**
