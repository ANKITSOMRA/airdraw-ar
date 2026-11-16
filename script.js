/**
 * AR GESTURE DRAWING — script.js (ENHANCED v2.0)
 * Base logic, structure, and flow from original — extended with:
 *  🔹 Smart finger auto-detection (fallback to longest extended finger)
 *  🔹 Improved gesture reliability with debounce & hysteresis
 *  🔹 Dynamic brush thickness based on finger speed
 *  🔹 Gesture-based undo (swipe left)
 *  🔹 Gesture: thumb-up → cycle color, open-palm → clear
 *  🔹 Enhanced exponential smoothing + jump guard
 *  🔹 Stroke history for undo
 *  🔹 Active finger indicator in HUD
 *  🔹 Eraser size preview cursor
 *  🔹 Multi-hand guard (only primary hand tracked)
 */

/* ═══════════════════════════════════════════════
   GLOBAL STATE  (original + new fields marked 🔹)
═══════════════════════════════════════════════ */
const state = {
  drawing:      false,
  paused:       false,
  mirror:       true,
  brushSize:    4,
  brushColor:   '#00f5d4',
  gesture:      'none',
  erasing:      false,
  unityReady:   false,
  cameraReady:  false,
  handDetected: false,
  lastX:        null,
  lastY:        null,
  smoothX:      null,
  smoothY:      null,
  alpha:        0.30,          // exponential smoothing factor

  // 🔹 Smart finger detection
  activeFinger:    8,          // landmark index of active fingertip (default: index=8)
  fingerSwitchCooldown: 0,     // frames before we allow finger re-selection

  // 🔹 Gesture debounce / hysteresis — prevents flicker
  gestureBuffer:   [],         // last N classified gestures
  GESTURE_BUF_LEN: 6,
  confirmedGesture:'none',     // only changes after buffer majority-votes

  // 🔹 Dynamic brush thickness
  prevSmX: null, prevSmY: null,
  fingerSpeed: 0,

  // 🔹 Undo system
  strokeHistory:  [],          // array of ImageData snapshots
  MAX_UNDO:       20,
  isUndoing:      false,

  // 🔹 Swipe-left gesture detection
  swipeBuffer:    [],          // last N x-positions for swipe detection
  SWIPE_BUF_LEN:  12,
  lastSwipeTime:  0,

  // 🔹 Thumb-up color cycle
  colorIndex:     0,
  lastThumbTime:  0,
  THUMB_COOLDOWN: 1200,        // ms between color changes via thumb

  // 🔹 Open-palm clear cooldown
  lastClearTime:  0,
  CLEAR_COOLDOWN: 2000,

  // 🔹 Jump guard — ignore positions that teleport > threshold pixels
  MAX_JUMP_PX:    120,
};

// Stroke trail for smooth brush rendering (original)
const trail = [];
const TRAIL_LEN = 6;

// 🔹 Color palette for thumb-up cycling
const COLOR_PALETTE = [
  '#00f5d4', '#f72fca', '#f7d52f', '#2ff75e', '#ff6b35', '#ffffff',
  '#4fc3f7', '#e040fb', '#ff5252', '#69f0ae',
];

/* ═══════════════════════════════════════════════
   DOM REFS  (original — unchanged)
═══════════════════════════════════════════════ */
const bootScreen   = document.getElementById('boot-screen');
const bootStatus   = document.getElementById('boot-status');
const app          = document.getElementById('app');
const webcamEl     = document.getElementById('webcam');
const handCanvas   = document.getElementById('hand-canvas');
const drawCanvas   = document.getElementById('draw-canvas');
const handCtx      = handCanvas.getContext('2d');
const drawCtx      = drawCanvas.getContext('2d');
const fingerCursor = document.getElementById('finger-cursor');
const mirrorBadge  = document.getElementById('mirror-badge');

const colorSwatches  = document.querySelectorAll('.swatch');
const customColorIn  = document.getElementById('custom-color');
const brushSlider    = document.getElementById('brush-slider');
const brushVal       = document.getElementById('brush-val');
const btnPause       = document.getElementById('btn-pause');
const btnMirror      = document.getElementById('btn-mirror');
const btnClear       = document.getElementById('btn-clear');
const btnSave        = document.getElementById('btn-save');
const btnUndo        = document.getElementById('btn-undo'); // 🔹 new button

const dotCamera    = document.getElementById('dot-camera');
const dotHands     = document.getElementById('dot-hands');
const dotUnity     = document.getElementById('dot-unity');
const dotDraw      = document.getElementById('dot-draw');
const drawStateTxt = document.getElementById('draw-state-txt');

const gestureIcon  = document.getElementById('gesture-icon');
const gestureLabel = document.getElementById('gesture-label');
const fingerLabel  = document.getElementById('finger-label'); // 🔹 new HUD element

const unityContainer    = document.getElementById('unity-container');
const unityLoadingCover = document.getElementById('unity-loading-cover');
const unityProgressBar  = document.getElementById('unity-progress-bar');
const unityFallback     = document.getElementById('unity-fallback-note');

const helpBtn     = document.getElementById('help-btn');
const helpOverlay = document.getElementById('help-overlay');
const helpClose   = document.getElementById('help-close');

/* ═══════════════════════════════════════════════
   RESIZE CANVASES  (original — unchanged)
═══════════════════════════════════════════════ */
function resizeCanvases() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  [handCanvas, drawCanvas].forEach(c => {
    c.width  = w;
    c.height = h;
  });
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

/* ═══════════════════════════════════════════════
   BOOT SEQUENCE  (original — unchanged)
═══════════════════════════════════════════════ */
const bootMessages = [
  'Initializing systems…',
  'Loading MediaPipe Hands…',
  'Requesting camera access…',
  'Calibrating gesture engine…',
  'Launching AR pipeline…',
];

async function runBoot() {
  for (let i = 0; i < bootMessages.length; i++) {
    bootStatus.textContent = bootMessages[i];
    await delay(420 + Math.random() * 180);
  }
  bootScreen.style.transition = 'opacity 0.6s ease';
  bootScreen.style.opacity = '0';
  await delay(620);
  bootScreen.classList.add('hidden');
  app.classList.remove('hidden');
  initCamera();
  initUI();
  initUnityBridge();
}

runBoot();

/* ═══════════════════════════════════════════════
   CAMERA + MEDIAPIPE  (original — unchanged)
═══════════════════════════════════════════════ */
let handsModel = null;

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    webcamEl.srcObject = stream;
    await webcamEl.play();
    state.cameraReady = true;
    dotCamera.className = 'status-dot ok';
  } catch (err) {
    dotCamera.className = 'status-dot err';
    console.error('Camera error:', err);
    alert('Camera access denied. Please allow camera permissions and reload.');
    return;
  }

  handsModel = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  handsModel.setOptions({
    maxNumHands:            1,
    modelComplexity:        1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.6,
  });

  handsModel.onResults(onHandResults);

  const camera = new Camera(webcamEl, {
    onFrame: async () => {
      await handsModel.send({ image: webcamEl });
    },
    width:  1280,
    height: 720,
  });
  camera.start();

  dotHands.className = 'status-dot warn';
}

/* ═══════════════════════════════════════════════
   🔹 SMART FINGER DETECTION
   If index finger (tip=8, pip=6) isn't clearly extended,
   find the finger with the greatest tip-to-palm distance.
   Fingertip landmark indices: Thumb=4, Index=8, Middle=12, Ring=16, Pinky=20
   Palm base landmark: 0
═══════════════════════════════════════════════ */
const FINGER_TIPS = [
  { tip: 4,  pip: 3,  name: 'Thumb'  },
  { tip: 8,  pip: 6,  name: 'Index'  },
  { tip: 12, pip: 10, name: 'Middle' },
  { tip: 16, pip: 14, name: 'Ring'   },
  { tip: 20, pip: 18, name: 'Pinky'  },
];

/**
 * Returns the landmark index of the best finger tip to use.
 * Prefers index finger; falls back to most-extended finger.
 * Cooldown prevents rapid switching (flickering).
 */
function selectActiveFinger(lm) {
  // Decrement cooldown
  if (state.fingerSwitchCooldown > 0) {
    state.fingerSwitchCooldown--;
    return state.activeFinger; // keep current during cooldown
  }

  const palmBase = lm[0];

  // Check if index finger is clearly up (tip well above pip)
  const indexTip = lm[8];
  const indexPip = lm[6];
  const indexIsUp = indexTip.y < indexPip.y - 0.04; // 0.04 threshold for clarity

  if (indexIsUp) {
    if (state.activeFinger !== 8) {
      state.activeFinger = 8;
      state.fingerSwitchCooldown = 10; // 10 frames before next switch
      updateFingerLabel('Index');
    }
    return 8;
  }

  // Index not clearly visible — find the most extended finger by
  // Euclidean distance from palm base to each fingertip
  let bestTip  = 8;
  let bestDist = -1;
  let bestName = 'Index';

  for (const f of FINGER_TIPS) {
    const tip = lm[f.tip];
    const dx  = tip.x - palmBase.x;
    const dy  = tip.y - palmBase.y;
    const dz  = (tip.z || 0) - (palmBase.z || 0);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > bestDist) {
      bestDist = dist;
      bestTip  = f.tip;
      bestName = f.name;
    }
  }

  if (state.activeFinger !== bestTip) {
    state.activeFinger = bestTip;
    state.fingerSwitchCooldown = 10;
    updateFingerLabel(bestName);
  }

  return bestTip;
}

function updateFingerLabel(name) {
  if (fingerLabel) fingerLabel.textContent = `✦ ${name}`;
}

/* ═══════════════════════════════════════════════
   🔹 GESTURE DEBOUNCE / HYSTERESIS
   Raw classification is noisy; we only confirm a gesture
   after it appears in the majority of the last N frames.
═══════════════════════════════════════════════ */
function debounceGesture(raw) {
  state.gestureBuffer.push(raw);
  if (state.gestureBuffer.length > state.GESTURE_BUF_LEN) {
    state.gestureBuffer.shift();
  }

  // Count occurrences
  const counts = {};
  for (const g of state.gestureBuffer) counts[g] = (counts[g] || 0) + 1;

  // Majority vote (needs > half the buffer)
  let winner = state.confirmedGesture;
  const threshold = Math.floor(state.GESTURE_BUF_LEN / 2) + 1;
  for (const [g, cnt] of Object.entries(counts)) {
    if (cnt >= threshold) { winner = g; break; }
  }

  state.confirmedGesture = winner;
  return winner;
}

/* ═══════════════════════════════════════════════
   🔹 SWIPE-LEFT DETECTION (for undo)
   Track x-position of active fingertip; if it moves
   significantly left within the buffer window, trigger undo.
═══════════════════════════════════════════════ */
function detectSwipeLeft(x) {
  state.swipeBuffer.push(x);
  if (state.swipeBuffer.length > state.SWIPE_BUF_LEN) {
    state.swipeBuffer.shift();
  }
  if (state.swipeBuffer.length < state.SWIPE_BUF_LEN) return false;

  const first = state.swipeBuffer[0];
  const last  = state.swipeBuffer[state.swipeBuffer.length - 1];
  const delta = last - first; // negative = moved left

  const now = Date.now();
  // Only fire if: moved left >15% of screen width, not recently fired
  if (delta < -(window.innerWidth * 0.15) &&
      now - state.lastSwipeTime > 1200) {
    state.lastSwipeTime = now;
    state.swipeBuffer = []; // reset
    return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════
   MEDIAPIPE RESULTS HANDLER  (modified 🔹)
═══════════════════════════════════════════════ */
function onHandResults(results) {
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    state.handDetected  = false;
    dotHands.className  = 'status-dot warn';
    updateGestureHUD('none');
    state.drawing       = false;
    fingerCursor.style.display = 'none';
    // Clear gesture buffer on hand loss
    state.gestureBuffer = [];
    return;
  }

  state.handDetected = true;
  dotHands.className = 'status-dot ok';

  // 🔹 Always use first detected hand (multi-hand guard: maxNumHands=1 in model,
  //    but this guard makes the intent explicit)
  const landmarks = results.multiHandLandmarks[0];
  drawHandSkeleton(landmarks);

  // 🔹 Smart finger selection
  const tipIdx = selectActiveFinger(landmarks);
  const tip    = landmarks[tipIdx];

  const screenW = handCanvas.width;
  const screenH = handCanvas.height;
  let rawX = tip.x;
  if (state.mirror) rawX = 1 - rawX;

  const sx = rawX * screenW;
  const sy = tip.y * screenH;

  // 🔹 Jump guard — ignore teleportation (hand redetection artifacts)
  if (state.smoothX !== null) {
    const jumpDist = Math.hypot(sx - state.smoothX, sy - state.smoothY);
    if (jumpDist > state.MAX_JUMP_PX) {
      // Soft-reset: don't draw this frame, let smoother catch up gradually
      state.smoothX = lerp(state.smoothX, sx, 0.2);
      state.smoothY = lerp(state.smoothY, sy, 0.2);
      state.lastX   = null;
      state.lastY   = null;
      return;
    }
  }

  // Exponential smoothing (original, kept)
  if (state.smoothX === null) {
    state.smoothX = sx;
    state.smoothY = sy;
  } else {
    state.smoothX = lerp(state.smoothX, sx, state.alpha);
    state.smoothY = lerp(state.smoothY, sy, state.alpha);
  }

  // 🔹 Compute finger speed for dynamic brush thickness
  if (state.prevSmX !== null) {
    state.fingerSpeed = Math.hypot(
      state.smoothX - state.prevSmX,
      state.smoothY - state.prevSmY
    );
  }
  state.prevSmX = state.smoothX;
  state.prevSmY = state.smoothY;

  // 🔹 Classify gesture with debounce
  const rawGesture = classifyGesture(landmarks);
  const gesture    = debounceGesture(rawGesture);
  state.gesture    = gesture;
  state.erasing    = gesture === 'two_fingers';
  updateGestureHUD(gesture);

  // 🔹 Swipe-left → undo (only when not drawing)
  if (gesture === 'index_up' || gesture === 'other') {
    if (detectSwipeLeft(state.smoothX) && !state.drawing) {
      undoLastStroke();
    }
  }

  // 🔹 Thumb-up → cycle color (with cooldown)
  if (gesture === 'thumb_up') {
    const now = Date.now();
    if (now - state.lastThumbTime > state.THUMB_COOLDOWN) {
      state.lastThumbTime = now;
      cycleColor();
    }
  }

  // 🔹 Open palm → clear screen (with cooldown to avoid accidents)
  if (gesture === 'open_hand') {
    const now = Date.now();
    if (now - state.lastClearTime > state.CLEAR_COOLDOWN) {
      state.lastClearTime = now;
      clearDrawCanvas();
      sendClearToUnity();
      showToast('🧹 Canvas Cleared');
    }
  }

  // Update finger cursor
  fingerCursor.style.display = 'block';
  fingerCursor.style.left    = `${state.smoothX}px`;
  fingerCursor.style.top     = `${state.smoothY}px`;
  fingerCursor.className     = state.erasing
    ? 'erasing'
    : (gesture === 'index_up' ? 'drawing' : '');

  // 🔹 Eraser cursor size preview
  if (state.erasing) {
    const er = state.brushSize * 5;
    fingerCursor.style.width  = `${er * 2}px`;
    fingerCursor.style.height = `${er * 2}px`;
  } else {
    fingerCursor.style.width  = '';
    fingerCursor.style.height = '';
  }

  // Decide pen-down state
  if (!state.paused) {
    if (gesture === 'index_up') {
      // 🔹 Save snapshot before starting a new stroke
      if (!state.drawing) saveStrokeSnapshot();
      state.drawing = true;
      dotDraw.className    = 'status-dot ok';
      drawStateTxt.textContent = 'Drawing';
    } else if (gesture === 'fist') {
      state.drawing = false;
      state.lastX   = null; state.lastY = null;
      dotDraw.className    = 'status-dot warn';
      drawStateTxt.textContent = 'Pen Up';
    } else if (gesture === 'two_fingers') {
      if (!state.drawing) saveStrokeSnapshot(); // 🔹 undo can restore before erasing
      state.drawing = true;
      dotDraw.className    = 'status-dot warn';
      drawStateTxt.textContent = 'Erasing';
    } else {
      state.drawing = false;
      state.lastX   = null; state.lastY = null;
      dotDraw.className    = 'status-dot warn';
      drawStateTxt.textContent = gesture === 'open_hand' ? 'Clear!' : 'Idle';
    }
  }

  // Draw stroke
  if (state.drawing && !state.paused) {
    if (state.erasing) {
      eraseAt(state.smoothX, state.smoothY, state.brushSize * 5);
    } else {
      drawStroke(state.smoothX, state.smoothY);
    }
    const nx = state.smoothX / screenW;
    const ny = state.smoothY / screenH;
    sendToUnity(nx, ny, state.drawing);
  } else {
    state.lastX = null; state.lastY = null;
    if (!state.paused) sendToUnity(state.smoothX / screenW, state.smoothY / screenH, false);
  }
}

/* ═══════════════════════════════════════════════
   GESTURE CLASSIFICATION  (🔹 extended with thumb_up, fist)
   Original finger detection logic kept intact.
═══════════════════════════════════════════════ */
function classifyGesture(lm) {
  const fingers = [
    isFingerUp(lm, 8,  6),   // index
    isFingerUp(lm, 12, 10),  // middle
    isFingerUp(lm, 16, 14),  // ring
    isFingerUp(lm, 20, 18),  // pinky
  ];
  const [index, middle, ring, pinky] = fingers;

  // 🔹 Thumb up detection: thumb tip above thumb MCP, other fingers down
  const thumbUp = lm[4].y < lm[2].y - 0.05 && !index && !middle && !ring && !pinky;
  if (thumbUp) return 'thumb_up';

  if (!index && !middle && !ring && !pinky) return 'fist';
  if (index && !middle && !ring && !pinky)  return 'index_up';
  if (index && middle && !ring && !pinky)   return 'two_fingers';
  if (index && middle && ring && pinky)     return 'open_hand';
  return 'other';
}

function isFingerUp(lm, tipIdx, pipIdx) {
  return lm[tipIdx].y < lm[pipIdx].y;
}

/* ═══════════════════════════════════════════════
   HAND SKELETON DRAWING  (original — unchanged)
═══════════════════════════════════════════════ */
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

function drawHandSkeleton(lm) {
  const w = handCanvas.width;
  const h = handCanvas.height;

  handCtx.save();
  handCtx.lineWidth   = 1.5;
  handCtx.strokeStyle = 'rgba(0,245,212,0.4)';
  handCtx.shadowBlur  = 8;
  handCtx.shadowColor = '#00f5d4';

  for (const [a, b] of HAND_CONNECTIONS) {
    let ax = lm[a].x, bx = lm[b].x;
    if (state.mirror) { ax = 1 - ax; bx = 1 - bx; }
    handCtx.beginPath();
    handCtx.moveTo(ax * w, lm[a].y * h);
    handCtx.lineTo(bx * w, lm[b].y * h);
    handCtx.stroke();
  }

  // 🔹 Highlight active fingertip differently from index
  for (let i = 0; i < lm.length; i++) {
    let lx = lm[i].x;
    if (state.mirror) lx = 1 - lx;
    const isActiveTip = i === state.activeFinger;
    handCtx.beginPath();
    handCtx.arc(lx * w, lm[i].y * h, isActiveTip ? 6 : 3, 0, Math.PI * 2);
    handCtx.fillStyle   = isActiveTip ? '#f7d52f' : 'rgba(0,245,212,0.5)';
    handCtx.shadowBlur  = isActiveTip ? 16 : 4;
    handCtx.shadowColor = isActiveTip ? '#f7d52f' : '#00f5d4';
    handCtx.fill();
  }

  handCtx.restore();
}

/* ═══════════════════════════════════════════════
   CANVAS DRAWING ENGINE  (🔹 dynamic brush thickness)
   Original glow + trail logic preserved.
═══════════════════════════════════════════════ */
function drawStroke(x, y) {
  trail.push({ x, y });
  if (trail.length > TRAIL_LEN) trail.shift();

  const px = state.lastX;
  const py = state.lastY;

  if (px === null || py === null) {
    state.lastX = x; state.lastY = y;
    return;
  }

  // 🔹 Dynamic brush: faster = slightly thinner (feels natural)
  // Speed clamped 0..30px/frame, maps to scale 0.7..1.3
  const speedFactor = 1.0 - clamp(state.fingerSpeed / 60, -0.3, 0.3);
  const dynamicSize = Math.max(1, state.brushSize * speedFactor);

  drawCtx.save();

  const glowPasses = [
    { blur: 18, alpha: 0.15, width: dynamicSize * 3.5 },
    { blur: 8,  alpha: 0.35, width: dynamicSize * 2   },
    { blur: 2,  alpha: 0.80, width: dynamicSize       },
    { blur: 0,  alpha: 1.00, width: dynamicSize * 0.6 },
  ];

  for (const pass of glowPasses) {
    drawCtx.beginPath();
    drawCtx.moveTo(px, py);

    if (trail.length >= 3) {
      const mid = trail[trail.length - 2];
      drawCtx.quadraticCurveTo(mid.x, mid.y, x, y);
    } else {
      drawCtx.lineTo(x, y);
    }

    drawCtx.lineCap   = 'round';
    drawCtx.lineJoin  = 'round';
    drawCtx.lineWidth = pass.width;
    drawCtx.globalAlpha              = pass.alpha;
    drawCtx.shadowBlur               = pass.blur;
    drawCtx.shadowColor              = state.brushColor;
    drawCtx.strokeStyle              = state.brushColor;
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.stroke();
  }

  drawCtx.restore();
  state.lastX = x;
  state.lastY = y;
}

function eraseAt(x, y, radius) {
  drawCtx.save();
  drawCtx.globalCompositeOperation = 'destination-out';
  drawCtx.beginPath();
  drawCtx.arc(x, y, radius, 0, Math.PI * 2);
  drawCtx.fillStyle = 'rgba(0,0,0,1)';
  drawCtx.fill();
  drawCtx.restore();
}

function clearDrawCanvas() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  state.lastX = null;
  state.lastY = null;
  trail.length = 0;
}

/* ═══════════════════════════════════════════════
   🔹 UNDO SYSTEM
   Before each new stroke starts, snapshot the canvas.
   Undo restores the last snapshot.
═══════════════════════════════════════════════ */
function saveStrokeSnapshot() {
  // Only save if not already in the middle of a stroke
  if (state.drawing) return;
  try {
    const snapshot = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
    state.strokeHistory.push(snapshot);
    if (state.strokeHistory.length > state.MAX_UNDO) {
      state.strokeHistory.shift(); // remove oldest
    }
    // Update undo button state
    if (btnUndo) btnUndo.disabled = false;
  } catch (e) {
    // getImageData can fail on tainted canvas (CORS); fail silently
  }
}

function undoLastStroke() {
  if (state.strokeHistory.length === 0) {
    showToast('Nothing to undo');
    return;
  }
  const snapshot = state.strokeHistory.pop();
  drawCtx.putImageData(snapshot, 0, 0);
  state.lastX = null; state.lastY = null;
  trail.length = 0;
  showToast('↩ Undone');
  sendClearToUnity(); // Unity doesn't support partial undo; clear and re-sync
  if (btnUndo) btnUndo.disabled = state.strokeHistory.length === 0;
}

/* ═══════════════════════════════════════════════
   🔹 COLOR CYCLE (thumb-up gesture)
═══════════════════════════════════════════════ */
function cycleColor() {
  state.colorIndex = (state.colorIndex + 1) % COLOR_PALETTE.length;
  const newColor   = COLOR_PALETTE[state.colorIndex];
  setColor(newColor);
  // Update active swatch visually
  colorSwatches.forEach(s => {
    s.classList.toggle('active', s.dataset.color === newColor);
  });
  showToast(`🎨 Color changed`);
}

/* ═══════════════════════════════════════════════
   SAVE DRAWING  (original — unchanged)
═══════════════════════════════════════════════ */
function saveDrawing() {
  const exportCanvas  = document.createElement('canvas');
  exportCanvas.width  = drawCanvas.width;
  exportCanvas.height = drawCanvas.height;
  const ectx = exportCanvas.getContext('2d');

  ectx.fillStyle = '#050810';
  ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  for (let y = 0; y < exportCanvas.height; y += 4) {
    ectx.fillStyle = 'rgba(0,0,0,0.06)';
    ectx.fillRect(0, y, exportCanvas.width, 2);
  }

  ectx.drawImage(drawCanvas, 0, 0);

  ectx.font      = '14px "Share Tech Mono", monospace';
  ectx.fillStyle = 'rgba(0,245,212,0.4)';
  ectx.fillText('AR GESTURE DRAW', 20, exportCanvas.height - 20);

  const link    = document.createElement('a');
  link.download = `gesture-drawing-${Date.now()}.png`;
  link.href     = exportCanvas.toDataURL('image/png');
  link.click();
  showToast('💾 Saved!');
}

/* ═══════════════════════════════════════════════
   UNITY WEBGL BRIDGE  (original — unchanged)
═══════════════════════════════════════════════ */
window.unityInstance = null;

function sendToUnity(nx, ny, penDown) {
  if (!window.unityInstance) return;
  try {
    const payload = `${nx.toFixed(5)},${ny.toFixed(5)},${penDown ? '1' : '0'}`;
    window.unityInstance.SendMessage('DrawingManager', 'ReceiveCoordinates', payload);
  } catch (e) {}
}

function sendColorToUnity(hex) {
  if (!window.unityInstance) return;
  try { window.unityInstance.SendMessage('DrawingManager', 'ReceiveColor', hex); }
  catch (e) {}
}

function sendBrushSizeToUnity(size) {
  if (!window.unityInstance) return;
  try { window.unityInstance.SendMessage('DrawingManager', 'ReceiveBrushSize', String(size)); }
  catch (e) {}
}

function sendClearToUnity() {
  if (!window.unityInstance) return;
  try { window.unityInstance.SendMessage('DrawingManager', 'ClearCanvas', ''); }
  catch (e) {}
}

function sendPauseToUnity(paused) {
  if (!window.unityInstance) return;
  try { window.unityInstance.SendMessage('DrawingManager', 'SetDrawingEnabled', paused ? 'false' : 'true'); }
  catch (e) {}
}

function initUnityBridge() {
  dotUnity.className = 'status-dot warn';

  const script  = document.createElement('script');
  script.src    = './Build/ARGestureDraw.loader.js';
  script.onload = () => startUnityLoader();
  script.onerror = () => {
    unityFallback.textContent =
      '⚠ Unity build not found. Running in Canvas-only mode. ' +
      'See instructions below to add your WebGL build.';
    dotUnity.className = 'status-dot warn';
    state.unityReady   = false;
    document.querySelector('.unity-spinner').style.display = 'none';
    document.querySelector('#unity-load-text').textContent = 'Canvas Mode Active';
    unityProgressBar.style.width = '100%';
    setTimeout(() => {
      unityLoadingCover.style.opacity    = '0';
      unityLoadingCover.style.transition = 'opacity 0.8s';
      setTimeout(() => { unityLoadingCover.style.display = 'none'; }, 800);
    }, 2000);
  };
  document.head.appendChild(script);
}

function startUnityLoader() {
  const config = {
    dataUrl:            './Build/ARGestureDraw.data',
    frameworkUrl:       './Build/ARGestureDraw.framework.js',
    codeUrl:            './Build/ARGestureDraw.wasm',
    streamingAssetsUrl: 'StreamingAssets',
    companyName:        'ARGesture',
    productName:        'AR Gesture Draw',
    productVersion:     '1.0',
  };

  createUnityInstance(document.getElementById('unity-canvas'), config, (progress) => {
    const pct = Math.round(progress * 100);
    unityProgressBar.style.width = `${pct}%`;
    document.getElementById('unity-load-text').textContent = `Loading Unity… ${pct}%`;
  })
  .then((instance) => {
    window.unityInstance = instance;
    state.unityReady     = true;
    dotUnity.className   = 'status-dot ok';
    unityLoadingCover.style.display = 'none';
    sendColorToUnity(state.brushColor);
    sendBrushSizeToUnity(state.brushSize);
  })
  .catch((err) => {
    console.error('Unity load error:', err);
    dotUnity.className = 'status-dot err';
    unityFallback.textContent = `Unity error: ${err.message}. Running in canvas-only mode.`;
    document.querySelector('.unity-spinner').style.display = 'none';
    unityProgressBar.style.width = '100%';
  });
}

window.OnUnityReady = function() {
  console.log('[Unity] DrawingManager ready');
  state.unityReady = true;
};

/* ═══════════════════════════════════════════════
   UI CONTROLS  (original + 🔹 undo button, keyboard shortcuts)
═══════════════════════════════════════════════ */
function initUI() {
  // Color swatches
  colorSwatches.forEach(sw => {
    sw.addEventListener('click', () => {
      colorSwatches.forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      setColor(sw.dataset.color);
    });
  });

  // Custom color picker
  customColorIn.addEventListener('input', (e) => {
    colorSwatches.forEach(s => s.classList.remove('active'));
    setColor(e.target.value);
  });

  // Brush slider
  brushSlider.addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value);
    brushVal.textContent = state.brushSize;
    sendBrushSizeToUnity(state.brushSize);
  });

  // Pause
  btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    btnPause.classList.toggle('active', !state.paused);
    btnPause.querySelector('.btn-icon').textContent = state.paused ? '▶' : '⏸';
    btnPause.querySelector('.btn-txt').textContent  = state.paused ? 'RESUME' : 'PAUSE';
    dotDraw.className    = state.paused ? 'status-dot err' : 'status-dot warn';
    drawStateTxt.textContent = state.paused ? 'Paused' : 'Idle';
    sendPauseToUnity(state.paused);
    if (state.paused) { state.lastX = null; state.lastY = null; }
  });

  // Mirror
  btnMirror.addEventListener('click', () => {
    state.mirror = !state.mirror;
    btnMirror.classList.toggle('active', state.mirror);
    app.classList.toggle('no-mirror', !state.mirror);
    mirrorBadge.classList.toggle('hidden', !state.mirror);
    state.lastX = null; state.lastY = null;
    state.smoothX = null; state.smoothY = null;
  });
  btnMirror.classList.add('active');
  mirrorBadge.classList.remove('hidden');

  // Clear
  btnClear.addEventListener('click', () => {
    saveStrokeSnapshot(); // 🔹 allow undo of clear
    clearDrawCanvas();
    sendClearToUnity();
    flashBtn(btnClear);
    showToast('🧹 Cleared');
  });

  // Save
  btnSave.addEventListener('click', () => {
    saveDrawing();
    flashBtn(btnSave);
  });

  // 🔹 Undo button
  if (btnUndo) {
    btnUndo.disabled = true;
    btnUndo.addEventListener('click', () => {
      undoLastStroke();
      flashBtn(btnUndo);
    });
  }

  // Help
  helpBtn.addEventListener('click', () => helpOverlay.classList.add('visible'));
  helpClose.addEventListener('click', () => helpOverlay.classList.remove('visible'));

  // 🔹 Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoLastStroke(); }
    if (e.key === 'c' || e.key === 'C') { saveStrokeSnapshot(); clearDrawCanvas(); sendClearToUnity(); showToast('🧹 Cleared'); }
    if (e.key === 's' || e.key === 'S') { saveDrawing(); }
    if (e.key === ' ')  { btnPause.click(); }
    if (e.key === 'Escape') { helpOverlay.classList.remove('visible'); }
  });
}

function setColor(hex) {
  state.brushColor = hex;
  customColorIn.value = hex;
  sendColorToUnity(hex);
  // Update cursor color
  fingerCursor.style.borderColor = hex;
}

function flashBtn(btn) {
  btn.style.transform = 'scale(0.9)';
  setTimeout(() => { btn.style.transform = ''; }, 150);
}

/* ═══════════════════════════════════════════════
   🔹 TOAST NOTIFICATIONS
   Lightweight non-blocking feedback messages.
═══════════════════════════════════════════════ */
let toastTimeout = null;
function showToast(msg) {
  let toast = document.getElementById('toast-msg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-msg';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 1800);
}

/* ═══════════════════════════════════════════════
   GESTURE HUD  (🔹 added thumb_up entry)
═══════════════════════════════════════════════ */
const GESTURE_MAP = {
  none:        { icon: '🚫', label: 'No Hand'     },
  fist:        { icon: '✊', label: 'Pen Up'       },
  index_up:    { icon: '☝️', label: 'Drawing'      },
  two_fingers: { icon: '✌️', label: 'Erasing'      },
  open_hand:   { icon: '🖐', label: 'Clear!'       }, // 🔹 now triggers clear
  thumb_up:    { icon: '👍', label: 'Color Cycle'  }, // 🔹 new
  other:       { icon: '🤙', label: 'Gesture…'     },
};

function updateGestureHUD(gesture) {
  const g = GESTURE_MAP[gesture] || GESTURE_MAP.other;
  gestureIcon.textContent  = g.icon;
  gestureLabel.textContent = g.label;
}

/* ═══════════════════════════════════════════════
   UTILS  (original + 🔹 clamp)
═══════════════════════════════════════════════ */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); } // 🔹
