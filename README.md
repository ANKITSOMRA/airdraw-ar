# 🎨 AirDraw AR — Touchless Spatial Canvas

[![AR/VR/MR](https://img.shields.io/badge/Subject-AR%20%2F%20VR%20%2F%20MR-blueviolet.svg)](#)
[![Vision](https://img.shields.io/badge/Vision-Google%20MediaPipe%20Hands-00f5d4.svg)](#)
[![Unity](https://img.shields.io/badge/Engine-Unity%20WebGL-black.svg)](#)
[![Status](https://img.shields.io/badge/Status-Completed-success.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](#)

> A real-time **Video See-Through Augmented Reality (VST-AR)** application and **Natural User Interface (NUI)** that transforms any standard monocular webcam into an interactive, touchless spatial canvas using client-side 3D hand pose estimation.

---

## 📖 Overview

Traditional digital art and spatial interfaces rely on physical hardware like mice, stylus pens, or capacitive touchscreens. **AirDraw AR** eliminates hardware dependency by leveraging Computer Vision and Deep Learning (via Google MediaPipe Hands) to track 21 3D hand landmarks at 30+ FPS directly in the browser.

Users can paint, erase, cycle colors, undo strokes, and clear the screen in mid-air using intuitive hand gestures with zero physical contact.

### 🌟 Core Highlights
- **Video See-Through AR (VST-AR):** Real-time video pass-through overlay with interactive holographic visual feedback.
- **Smart Finger Auto-Detection & Fallback:** Heuristically calculates 3D Euclidean distances from the palm base to all fingertips, automatically falling back to the longest extended finger if the index finger is bent or occluded.
- **Anti-Jitter Filtering (LERP & Jump Guard):** Employs exponential moving average smoothing ($\alpha = 0.30$) and outlier rejection to eliminate hand tremors without introducing perceptual lag.
- **Velocity-Adaptive Brush Dynamics:** Dynamically scales stroke thickness inversely or proportionally with finger velocity, simulating natural calligraphic pressure physics.
- **Hybrid Dual-Engine Architecture:** Operates standalone on an optimized multi-pass glow HTML5 2D Canvas stack, while also streaming normalized coordinates to a Unity 3D WebGL engine for volumetric Catmull-Rom spline curves.

---

## 🖐️ Gesture Control Guide

| Gesture | Hand Pose | Action | Visual Feedback |
| :---: | :---: | :---: | :---: |
| ☝️ **Index Up** | Index extended, other fingers folded | **Draw Mode** (Pen Down) | Cyan Glowing Trail |
| ✊ **Fist** | All fingers curled below PIP joints | **Hover Mode** (Pen Up) | Reticle Cursor |
| ✌️ **Two Fingers** | Index + Middle extended (Peace Sign) | **Erase Mode** | Expanding Eraser Ring |
| 👍 **Thumb Up** | Thumb extended upward | **Cycle Color Palette** | Swatch & Toast Notice |
| 🖐 **Open Palm** | All 5 fingers extended outward | **Clear Canvas** (Hold) | Full Canvas Reset |
| ↖ **Swipe Left** | Rapid leftward fingertip motion ($>15\%$ screen) | **Undo Last Stroke** | Restores Prior Snapshot |

---

## 🏗️ System Architecture

```
                       +-----------------------+
                       | Standard Webcam Feed  |
                       +-----------+-----------+
                                   |
                                   v
                    +-----------------------------+
                    | Google MediaPipe Hands (ML) |
                    |  (21 3D Landmarks @ 30 FPS) |
                    +--------------+--------------+
                                   |
                                   v
             +-------------------------------------------+
             | Signal Processing & Heuristic Pipeline    |
             | • Mirror Transformation                   |
             | • Smart Extended Finger Fallback          |
             | • Exponential Moving Average (LERP α=0.30)|
             | • Jump Guard / Outlier Rejection (>120px) |
             | • Hysteresis Temporal Gesture Debouncer   |
             +---------------------+---------------------+
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
       +-----------------------+       +-------------------------+
       | HTML5 Canvas Pipeline |       | Unity 3D WebGL Bridge   |
       | • Hand Skeleton Overlay|       | • ARGesturePlugin.jslib |
       | • Multi-pass Neon Glow|       | • DrawingManager.cs     |
       | • Stroke History Stack|       | • ScreenToWorldPoint 3D |
       | • PNG Exporter        |       | • Catmull-Rom Splines   |
       +-----------------------+       +-------------------------+
```

---

## 🛠️ Tech Stack & Implementation Details

- **Vision & ML:** Google MediaPipe Hands (`@mediapipe/camera_utils`, `@mediapipe/hands`)
- **Frontend / UI:** Vanilla JavaScript (ES6+), HTML5 Canvas API, CSS3 Glassmorphism (Cyberpunk HUD)
- **3D Graphics Engine:** Unity (C#) via WebGL (`DrawingManager.cs`, `ARGesturePlugin.jslib`)
- **Signal Algorithms:**
  - **LERP:** $\text{smoothX} = \text{smoothX} + (\text{rawX} - \text{smoothX}) \times \alpha$
  - **Catmull-Rom Splines:** Smooth cubic Hermite spline interpolation with 4 subdivisions per segment in Unity.
  - **Temporal Debouncing:** 6-frame majority-voting buffer for gesture classification stability.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + Z` | Undo last stroke |
| `Space` | Pause / Resume drawing engine |
| `C` | Clear canvas |
| `S` | Save / Export artwork as PNG |
| `Esc` | Close help overlay modal |

---

## 🚀 Quick Start / How to Run Locally

### Prerequisites
You only need a modern web browser (Chrome, Edge, Safari, or Firefox) and a webcam.

### Running with a Local Server
Because webcams and WebAssembly require secure origins (HTTPS or localhost):

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ANKITSOMRA/airdraw-ar.git
   cd airdraw-ar
   ```

2. **Serve the directory:**
   Using Python:
   ```bash
   python3 -m http.server 8000
   ```
   Or using VS Code:
   - Install the **Live Server** extension.
   - Right click `index.html` and click **"Open with Live Server"**.

3. **Open in Browser:**
   Navigate to `http://localhost:8000` and grant camera permissions when prompted.

---

## 🎮 Unity WebGL Integration (Optional 3D Engine)

To enable the volumetric Unity 3D rendering engine alongside the web canvas:
1. Open your Unity project (Version 2021.3 LTS or newer recommended).
2. Attach `DrawingManager.cs` to a GameObject named `DrawingManager` in your scene.
3. Place `ARGesturePlugin.jslib` in `Assets/Plugins/WebGL/`.
4. Go to **File $\rightarrow$ Build Settings $\rightarrow$ WebGL $\rightarrow$ Build**.
5. Copy the generated `Build/` folder into the root directory next to `index.html`.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
