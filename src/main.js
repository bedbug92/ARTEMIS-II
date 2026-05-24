import * as THREE from 'three';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { NASA_TRAJ, NASA_MOON, TRAJ_START_DAY, TRAJ_END_DAY, TRAJ_STEP_DAYS, TLI_INDEX } from './data/trajectory.js';
import { computeVelocities, getInterpolatedState, horizonsToThree } from './math/interpolator.js';
import {
  initScene,
  scene,
  camera,
  renderer,
  controls,
  earthGroup,
  earthMesh,
  earthTiltGroup,
  moonGroup,
  moonMesh,
  orionGroup,
  traveledLine,
  projectedLine,
  emLine,
  gridFloor,
  earthLabel,
  moonLabel,
  orionLabel,
  beaconSprite,
  create3DLabel,
  SCALE,
  EARTH_RADIUS,
  MOON_RADIUS
} from './webgl/scene.js';

// Precomputed velocities
let orionVelocities = [];
let moonVelocities = [];

// Apogee index (max Earth distance — turn-around point of free-return)
let APOGEE_INDEX = 716; // Will be refined during precomputation

// Mission Constants & Configurations
const LAUNCH_TIME = Date.UTC(2026, 3, 1, 22, 35, 0); // Launch: Apr 1, 2026 22:35 UTC
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

// Subdivision factor for smooth trajectory line rendering
const LINE_SUBDIV = 3;

// Queue of key events with MET and exact day
const MISSION_PHASES = [
  { name: 'Orion/ICPS separation', day: 0.141875, met: 'T+0/03:24:18', desc: 'Orion separates from the Space Launch System (SLS) Interim Cryogenic Propulsion Stage (ICPS) in High Earth Orbit.' },
  { name: 'Translunar injection', day: 1.05125, met: 'T+1/01:13:48', desc: 'Orion executes the Trans-Lunar Injection (TLI) burn, accelerating out of Earth orbit toward the Moon.' },
  { name: 'Outbound correction burn', day: 4.18617, met: 'T+4/04:28:05', desc: 'Outbound trajectory correction burn (OTC-1) refines Orion\'s path to hit the target lunar flyby altitude.' },
  { name: 'Lunar SOI entry', day: 4.29412, met: 'T+4/07:03:32', desc: 'Orion enters the Moon\'s Sphere of Influence (SOI), where lunar gravity becomes the dominant force.' },
  { name: 'Closest lunar approach', day: 5.01792, met: 'T+5/00:25:48', desc: 'Orion reaches closest approach to the Moon, passing 6,545 km above the lunar far-side surface.' },
  { name: 'Maximum Earth distance', day: 5.02069, met: 'T+5/00:29:48', desc: 'Orion reaches its furthest point from Earth (413,146 km center-to-center), breaking the Apollo 13 record.' },
  { name: 'Return correction burn 1', day: 6.50000, met: 'T+6/12:00:00', desc: 'Return trajectory correction burn (RTC-1) aligns the spacecraft for atmospheric entry at Earth.' },
  { name: 'Splashdown / Re-entry', day: 9.05092, met: 'T+9/01:32:00', desc: 'Orion performs a skip re-entry through Earth\'s atmosphere, splashing down safely in the Pacific Ocean.' }
];

// Application state variables
let isPlaying = true;
let speedMult = 1000; // 1 second real time = 1000 seconds simulation time
let simDay = TRAJ_START_DAY;
let isScrubbing = false;
let trueScale = false; // Toggled by checkbox

let prevFrameTime = Date.now();

// Interactive camera target tracking
let cameraMode = 'overview'; // 'overview', 'follow', 'earth', 'moon'
let targetPos = null;
let targetLook = null;

// Precalculated curves for 3D trajectory lines
let fullTrajPointsTrue = [];
let fullTrajPointsVisual = [];

// Pre-built flat position arrays for line geometry (avoid conversion per frame)
let flatTrajTrue = null;
let flatTrajVisual = null;
let lastTrailIndex = -1;

// Co-rotating frame projection caches
let corotatingLoopPoints = [];

// Precalculated telemetry charts data arrays
let chartVelocityData = [];
let chartEarthRangeData = [];
let chartMoonRangeData = [];
let maxVelocity = 0;
let maxEarthRange = 0;
let maxMoonRange = 0;

// Initialize telemetry charts (HTML5 canvases)
const canvases = {
  velocity: null,
  earth: null,
  moon: null
};

// ═══════════════════════════════════════════
// CO-ROTATING MATH
// ═══════════════════════════════════════════
// Project a point relative to Earth into the Earth-Moon co-rotating frame.
// Returns coordinates: x' (along Earth-Moon line), y' (perpendicular in orbit plane), z' (perpendicular to orbit plane)
function projectToCoRotating(orionPos, moonPos) {
  const r_moon = new THREE.Vector3(moonPos[0], moonPos[1], moonPos[2]);
  const d_moon = r_moon.length();
  
  // Unit vector from Earth to Moon (X-axis in co-rotating frame)
  const ex = r_moon.clone().normalize();
  
  // Z-axis (normal to orbital plane)
  // Ecliptic coordinates mean Z is perpendicular to the ecliptic plane, so orbit plane is close to XY.
  const ez = new THREE.Vector3(0, 0, 1);
  
  // Y-axis (completes the orthonormal frame)
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  
  const r_orion = new THREE.Vector3(orionPos[0], orionPos[1], orionPos[2]);
  
  const xp = r_orion.dot(ex);
  const yp = r_orion.dot(ey);
  const zp = r_orion.dot(ez);
  
  return { xp, yp, zp, d_moon };
}

// Map co-rotating coordinates to 2D SVG space for the overview map
function get2DSvgCoords(xp, yp, d_moon) {
  // Earth is at (0, 0) -> SVG (50, 70)
  // Moon is at (d_moon, 0) -> SVG (200, 70)
  const scaleX = 150 / d_moon;
  const scaleY = 320 / d_moon; // Slightly larger scale factor for y to make loop look nice in 2D
  
  const svgX = 50 + xp * scaleX;
  const svgY = 70 + yp * scaleY;
  
  return { x: svgX, y: svgY };
}

// Build 2D co-rotating SVG path representation
function buildCoRotatingTrajectoryPath() {
  const dPath = [];
  const activePath = [];
  const N = NASA_TRAJ.length;
  
  for (let i = 0; i < N; i++) {
    const corot = projectToCoRotating(NASA_TRAJ[i], NASA_MOON[i]);
    const svg = get2DSvgCoords(corot.xp, corot.yp, corot.d_moon);
    corotatingLoopPoints.push(svg);
    
    const cmd = (i === 0) ? 'M' : 'L';
    dPath.push(`${cmd} ${svg.x.toFixed(1)} ${svg.y.toFixed(1)}`);
  }
  
  document.getElementById('overview-map-svg').querySelector('#map-trajectory').setAttribute('d', dPath.join(' '));
}

// Update the 2D co-rotating path segment that represents history
function updateActiveCoRotatingPath(currentIndex) {
  const N = corotatingLoopPoints.length;
  const activePts = corotatingLoopPoints.slice(0, Math.min(N, Math.max(1, currentIndex)));
  
  let dVal = '';
  if (activePts.length > 0) {
    dVal = activePts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }
  
  const activePathElem = document.getElementById('overview-map-svg').querySelector('#map-trajectory-active');
  activePathElem.setAttribute('d', dVal);

  // Position spacecraft dot
  const currentIdx = Math.min(N - 1, Math.max(0, Math.floor(currentIndex)));
  const currentPt = corotatingLoopPoints[currentIdx];
  if (currentPt) {
    const spaceDot = document.getElementById('overview-map-svg').querySelector('#map-orion');
    const glowDot = document.getElementById('overview-map-svg').querySelector('#map-orion-glow');
    spaceDot.setAttribute('cx', currentPt.x.toFixed(1));
    spaceDot.setAttribute('cy', currentPt.y.toFixed(1));
    glowDot.setAttribute('cx', currentPt.x.toFixed(1));
    glowDot.setAttribute('cy', currentPt.y.toFixed(1));
  }
}

// ═══════════════════════════════════════════
// PROCEDURAL SCALE WARPING (VISUAL MODE)
// ═══════════════════════════════════════════
// Converts true scale positions into warped visual scale coordinates.
// This is critical when trueScale = false, where Earth and Moon are scaled up and closer.
function getWarpedVisualPosition(positions, velocities, day) {
  const trueState = getInterpolatedState(positions, velocities, day);
  const moonState = getInterpolatedState(NASA_MOON, moonVelocities, day);
  
  const r_orion_true = trueState.position;
  const r_moon_true = moonState.position;
  
  const d_moon_true = r_moon_true.length();
  const dir_moon = r_moon_true.clone().normalize();
  
  // 1. Position Moon at 45 units in Three.js (comfortable visual distance)
  const compressedMoonDistance = 45;
  const moonPosVisual = dir_moon.clone().multiplyScalar(compressedMoonDistance);
  
  // 2. Project Orion to co-rotating frame coordinates
  const corot = projectToCoRotating(
    [r_orion_true.x, r_orion_true.y, r_orion_true.z],
    [r_moon_true.x, r_moon_true.y, r_moon_true.z]
  );
  
  // We re-compute projectToCoRotating exactly with Vectors to prevent precision mismatches
  const ex = dir_moon.clone();
  const ez = new THREE.Vector3(0, 0, 1);
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  
  const xp = r_orion_true.dot(ex);
  const yp = r_orion_true.dot(ey);
  const zp = r_orion_true.dot(ez);
  
  // 3. Scale components relative to compressed Moon distance
  const lambda = xp / d_moon_true; // Fraction along Earth-Moon axis
  
  const compressionRatio = compressedMoonDistance / d_moon_true;
  
  // Slightly amplify perpendicular components in visual scale so loops remain distinct and beautiful
  const amplificationY = 1.35; 
  const amplificationZ = 1.35;
  
  const xp_comp = lambda * compressedMoonDistance;
  const yp_comp = yp * compressionRatio * amplificationY;
  const zp_comp = zp * compressionRatio * amplificationZ;
  
  // 4. Construct back to 3D Cartesian coordinates
  const posVisual = new THREE.Vector3()
    .addScaledVector(ex, xp_comp)
    .addScaledVector(ey, yp_comp)
    .addScaledVector(ez, zp_comp);
    
  return { position: posVisual, trueVelocity: trueState.velocity };
}

// ═══════════════════════════════════════════
// TRAJECTORY DATA PRE-PROCESSING & BUILD
// ═══════════════════════════════════════════
// Build complete array of 3D points for line rendering (both modes)
function buildLinePoints() {
  const N = NASA_TRAJ.length;

  fullTrajPointsTrue = [];
  fullTrajPointsVisual = [];

  for (let i = 0; i < N - 1; i++) {
    const dayStart = TRAJ_START_DAY + i * TRAJ_STEP_DAYS;
    
    for (let s = 0; s < LINE_SUBDIV; s++) {
      const stepDay = dayStart + (s / LINE_SUBDIV) * TRAJ_STEP_DAYS;
      
      // True scale points
      const trueState = getInterpolatedState(NASA_TRAJ, orionVelocities, stepDay);
      fullTrajPointsTrue.push(trueState.position.clone().multiplyScalar(SCALE));
      
      // Visual scale points
      const visualState = getWarpedVisualPosition(NASA_TRAJ, orionVelocities, stepDay);
      fullTrajPointsVisual.push(visualState.position);
    }
  }
  
  // Add final point
  const endStateTrue = getInterpolatedState(NASA_TRAJ, orionVelocities, TRAJ_END_DAY);
  fullTrajPointsTrue.push(endStateTrue.position.clone().multiplyScalar(SCALE));

  const endStateVisual = getWarpedVisualPosition(NASA_TRAJ, orionVelocities, TRAJ_END_DAY);
  fullTrajPointsVisual.push(endStateVisual.position);

  // Build flat Float32Arrays for efficient line geometry updates
  flatTrajTrue = new Float32Array(fullTrajPointsTrue.length * 3);
  for (let i = 0; i < fullTrajPointsTrue.length; i++) {
    flatTrajTrue[i * 3] = fullTrajPointsTrue[i].x;
    flatTrajTrue[i * 3 + 1] = fullTrajPointsTrue[i].y;
    flatTrajTrue[i * 3 + 2] = fullTrajPointsTrue[i].z;
  }
  flatTrajVisual = new Float32Array(fullTrajPointsVisual.length * 3);
  for (let i = 0; i < fullTrajPointsVisual.length; i++) {
    flatTrajVisual[i * 3] = fullTrajPointsVisual[i].x;
    flatTrajVisual[i * 3 + 1] = fullTrajPointsVisual[i].y;
    flatTrajVisual[i * 3 + 2] = fullTrajPointsVisual[i].z;
  }
}

// ═══════════════════════════════════════════
// TELEMETRY CHARTS DRAWING (HTML5 CANVAS)
// ═══════════════════════════════════════════
// Precompute chart telemetry curves over the 1284 data nodes
function precomputeChartsData() {
  const N = NASA_TRAJ.length;
  chartVelocityData = [];
  chartEarthRangeData = [];
  chartMoonRangeData = [];

  for (let i = 0; i < N; i++) {
    const pos = NASA_TRAJ[i];
    const mpos = NASA_MOON[i];
    const vel = orionVelocities[i];
    
    const vMag = new THREE.Vector3(vel[0], vel[1], vel[2]).length();
    const dEarth = new THREE.Vector3(pos[0], pos[1], pos[2]).length();
    const dMoon = new THREE.Vector3(pos[0] - mpos[0], pos[1] - mpos[1], pos[2] - mpos[2]).length();

    chartVelocityData.push(vMag);
    chartEarthRangeData.push(dEarth);
    chartMoonRangeData.push(dMoon);

    if (vMag > maxVelocity) maxVelocity = vMag;
    if (dEarth > maxEarthRange) { maxEarthRange = dEarth; APOGEE_INDEX = i; }
    if (dMoon > maxMoonRange) maxMoonRange = dMoon;
  }
}

// Draws a chart canvas showing full history, gradient fill, current point cursor
function drawChart(canvasId, data, currentIdx, maxVal, colorHex, unit) {
  const canvas = canvases[canvasId];
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width;
  const height = canvas.height;
  
  ctx.clearRect(0, 0, width, height);

  if (data.length === 0) return;

  const activeIdx = Math.min(data.length - 1, Math.max(0, currentIdx));
  
  // Draw full curve line
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width;
    // Map value to Y: 5px margin top/bottom
    const y = height - 5 - (data[i] / maxVal) * (height - 10);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  
  // Gradient fill under the line
  const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
  fillGrad.addColorStop(0, `${colorHex}35`); // Translucent alpha
  fillGrad.addColorStop(1, `${colorHex}00`); // Transparent
  
  // Clone path for fill
  const fillPath = new Path2D();
  fillPath.moveTo(0, height);
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width;
    const y = height - 5 - (data[i] / maxVal) * (height - 10);
    fillPath.lineTo(x, y);
  }
  fillPath.lineTo(width, height);
  fillPath.closePath();
  
  ctx.fillStyle = fillGrad;
  ctx.fill(fillPath);

  // Stroke the main path
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();

  // Draw current time vertical cursor line
  const curX = (activeIdx / (data.length - 1)) * width;
  ctx.beginPath();
  ctx.setLineDash([2 * dpr, 2 * dpr]);
  ctx.moveTo(curX, 0);
  ctx.lineTo(curX, height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1 * dpr;
  ctx.stroke();
  ctx.setLineDash([]); // Reset line dash

  // Draw active point circle
  const curY = height - 5 - (data[activeIdx] / maxVal) * (height - 10);
  ctx.beginPath();
  ctx.arc(curX, curY, 4 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = colorHex;
  ctx.shadowBlur = 6 * dpr;
  ctx.fill();
  ctx.shadowBlur = 0; // Reset shadow
}

function handleChartsRender(currentIndex) {
  drawChart('velocity', chartVelocityData, currentIndex, maxVelocity, '#00d4ff', 'km/s');
  drawChart('earth', chartEarthRangeData, currentIndex, maxEarthRange, '#0088ff', 'km');
  drawChart('moon', chartMoonRangeData, currentIndex, maxMoonRange, '#ffc83b', 'km');
}

// ═══════════════════════════════════════════
// UI & EVENT HANDLERS
// ═══════════════════════════════════════════
function setupPlaybackUI() {
  const btnPlay = document.getElementById('btn-play');
  const btnReset = document.getElementById('btn-reset');
  const timelineRange = document.getElementById('timeline-range');
  const timelineFill = document.getElementById('timeline-fill');
  const trueScaleCheck = document.getElementById('check-true-scale');
  const selectView = document.getElementById('select-view');

  // Play/Pause Click Handler
  btnPlay.addEventListener('click', () => {
    isPlaying = !isPlaying;
    btnPlay.textContent = isPlaying ? 'Pause' : 'Play';
    btnPlay.classList.toggle('active', isPlaying);
    
    // Trigger middle overlay indicator
    const overlay = document.getElementById('center-play-overlay');
    overlay.textContent = isPlaying ? '▶' : '⏸';
    overlay.style.display = 'block';
    
    // Restart animation trigger
    overlay.style.animation = 'none';
    void overlay.offsetWidth; // Reflow
    overlay.style.animation = 'overlay-fade 0.8s ease-out forwards';
  });

  // Reset Click Handler
  btnReset.addEventListener('click', () => {
    simDay = TRAJ_START_DAY;
    isPlaying = false;
    btnPlay.textContent = 'Play';
    btnPlay.classList.remove('active');
    controls.reset();
    setCameraFocus(cameraMode);
  });

  // Speed selection handler
  const speedButtons = document.querySelectorAll('.speed-btn');
  speedButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      speedButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      speedMult = parseInt(btn.getAttribute('data-speed'));
    });
  });

  // Timeline slider scrubbing
  timelineRange.addEventListener('input', (e) => {
    isScrubbing = true;
    const val = parseInt(e.target.value);
    const timeRange = TRAJ_END_DAY - TRAJ_START_DAY;
    simDay = TRAJ_START_DAY + (val / 10000) * timeRange;
    timelineFill.style.width = `${val / 100}%`;
  });

  const stopScrubbing = () => { isScrubbing = false; };
  timelineRange.addEventListener('pointerup', stopScrubbing);
  timelineRange.addEventListener('touchend', stopScrubbing);

  // View focus dropdown
  selectView.addEventListener('change', (e) => {
    setCameraFocus(e.target.value);
  });

  // True Scale checkbox toggle
  trueScaleCheck.addEventListener('change', (e) => {
    trueScale = e.target.checked;
    
    // Animate scale transitions in Three.js
    handleScaleTransition();
  });

  // Build Mission Queue log UI
  const queueList = document.getElementById('queue-list');
  MISSION_PHASES.forEach((phase, idx) => {
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.innerHTML = `
      <div class="queue-item-title">${phase.name}</div>
      <div class="queue-item-time">${phase.met}</div>
    `;
    item.addEventListener('click', () => {
      // Jump to phase day
      simDay = phase.day;
      
      // Update UI active states
      document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    });
    queueList.appendChild(item);
  });

  // Render ticks on timeline range
  const ticksContainer = document.getElementById('timeline-ticks-container');
  const timeRange = TRAJ_END_DAY - TRAJ_START_DAY;
  
  // Key ticks to display labels (TLI, Approach, End)
  const labelTicks = [
    { label: 'Start', day: TRAJ_START_DAY },
    { label: 'TLI', day: MISSION_PHASES[1].day },
    { label: 'Lunar Flyby', day: MISSION_PHASES[4].day },
    { label: 'End', day: TRAJ_END_DAY }
  ];

  labelTicks.forEach(tick => {
    const pct = ((tick.day - TRAJ_START_DAY) / timeRange) * 100;
    const label = document.createElement('span');
    label.className = 'timeline-tick-label';
    label.style.left = `${pct}%`;
    label.textContent = tick.label;
    ticksContainer.appendChild(label);
  });
}

function setCameraFocus(mode) {
  cameraMode = mode;
  document.getElementById('select-view').value = mode;
  
  if (mode === 'follow') {
    const op = orionGroup.position.clone();
    targetPos = op.clone().add(new THREE.Vector3(2.5, 1.5, 3.5));
    targetLook = op;
  } else if (mode === 'earth') {
    const radius = trueScale ? (EARTH_RADIUS * SCALE) : 5;
    targetPos = new THREE.Vector3(0, radius * 3.5, radius * 5.5);
    targetLook = new THREE.Vector3(0, 0, 0);
  } else if (mode === 'moon') {
    const mp = moonGroup.position;
    const radius = trueScale ? (MOON_RADIUS * SCALE) : 2.5;
    targetPos = new THREE.Vector3(mp.x + radius * 3.5, mp.y + radius * 2.5, mp.z + radius * 5.5);
    targetLook = mp.clone();
  } else if (mode === 'overview') {
    const mid = moonGroup.position.clone().multiplyScalar(0.45);
    targetPos = new THREE.Vector3(mid.x + 85, 45, mid.z + 115);
    targetLook = new THREE.Vector3(mid.x, -35, mid.z);
  }
}

// Adjust mesh scales and positions when switching scale modes
function handleScaleTransition() {
  const duration = 800; // ms
  const startTime = Date.now();
  
  const startEscale = earthMesh.scale.x;
  const targetEscale = trueScale ? 1.0 : (5 / (EARTH_RADIUS * SCALE));
  
  const startMscale = moonMesh.scale.x;
  const targetMscale = trueScale ? 1.0 : (2.0 / (MOON_RADIUS * SCALE));

  const animateScale = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1.0, elapsed / duration);
    // Smooth stepping
    const ease = 1 - Math.pow(1 - progress, 3); // cubic ease out
    
    const esc = startEscale + (targetEscale - startEscale) * ease;
    earthMesh.scale.set(esc, esc, esc);
    
    const msc = startMscale + (targetMscale - startMscale) * ease;
    moonMesh.scale.set(msc, msc, msc);

    // Update label heights
    const curEarthRadius = trueScale ? (EARTH_RADIUS * SCALE) : 5;
    const curMoonRadius = trueScale ? (MOON_RADIUS * SCALE) : 2.0;
    earthLabel.position.set(0, curEarthRadius + 2.8, 0);
    moonLabel.position.set(0, curMoonRadius + 1.8, 0);

    if (progress < 1.0) {
      requestAnimationFrame(animateScale);
    } else {
      // Force instant focus refresh
      setCameraFocus(cameraMode);
    }
  };
  animateScale();
}

// Setup canvas high DPI resolutions for crisp graphs
function setupCanvasHighDPI(canvasId) {
  const canvas = document.getElementById(canvasId);
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  
  // Save references
  canvases[canvasId.replace('chart-', '')] = canvas;
}

// Initialize checkpoint labels in 3D scene (TLI, Close approach, max range)
function initScene3DLabels() {
  const N = NASA_TRAJ.length;

  const createCheckpointLabel = (text, idx, offset3d, color) => {
    const label = create3DLabel(text, color);
    
    // Positions are calculated depending on True/Visual scale during update,
    // so we store them in user data to reposition on every frame.
    label.userData = {
      index: idx,
      offset: offset3d
    };
    scene.add(label);
    return label;
  };

  createCheckpointLabel('TLI', TLI_INDEX, new THREE.Vector3(0, 1.2, 0), '#00d4ff');
  createCheckpointLabel('CLOSEST APPROACH', 712, new THREE.Vector3(0, 1.2, 0), '#ffc83b');
  createCheckpointLabel('MAX RANGE', 716, new THREE.Vector3(0, 1.2, 0), '#ff8844');
  createCheckpointLabel('RTC-1', 935, new THREE.Vector3(0, 1.2, 0), '#00d4ff');
  createCheckpointLabel('RTC-2', 1080, new THREE.Vector3(0, 1.2, 0), '#00d4ff');
}

// Reposition 3D checkpoint labels based on scale mode
function updateCheckpointLabels() {
  scene.children.forEach(child => {
    if (child instanceof THREE.Sprite && child.userData && child.userData.index !== undefined) {
      const idx = child.userData.index;
      const offset = child.userData.offset;
      
      let pos;
      if (trueScale) {
        const rawPos = NASA_TRAJ[idx];
        pos = horizonsToThree(rawPos[0], rawPos[1], rawPos[2]).multiplyScalar(SCALE);
      } else {
        const day = TRAJ_START_DAY + idx * TRAJ_STEP_DAYS;
        const warped = getWarpedVisualPosition(NASA_TRAJ, orionVelocities, day);
        pos = warped.position;
      }
      
      child.position.copy(pos).add(offset);
      child.lookAt(camera.position);
      
      // Dynamic label scaling based on camera distance
      const dist = camera.position.distanceTo(pos);
      const labelScale = Math.max(0.4, Math.min(1.2, dist / 18));
      child.scale.set(6 * labelScale, 0.75 * labelScale, 1);
    }
  });
}

// ═══════════════════════════════════════════
// MAIN RENDERING & SIMULATION LOOP
// ═══════════════════════════════════════════
function render() {
  requestAnimationFrame(render);
  
  const now = Date.now();
  const dt = (now - prevFrameTime) / 1000;
  prevFrameTime = now;

  // 1. Advance simulation day if playing
  if (isPlaying && !isScrubbing) {
    simDay += (dt * speedMult) / 86400; // convert seconds to days
    if (simDay > TRAJ_END_DAY) {
      simDay = TRAJ_END_DAY;
      isPlaying = false;
      document.getElementById('btn-play').textContent = 'Play';
      document.getElementById('btn-play').classList.remove('active');
    }
  }

  // Current index in data array
  const fIdx = (simDay - TRAJ_START_DAY) / TRAJ_STEP_DAYS;
  const currentDataIndex = Math.max(0, Math.min(NASA_TRAJ.length - 1, fIdx));

  // 2. Fetch/Interpolate state vectors for Orion and Moon
  let orionPos, moonPos, trueVel;
  
  if (trueScale) {
    const state = getInterpolatedState(NASA_TRAJ, orionVelocities, simDay);
    orionPos = state.position.multiplyScalar(SCALE);
    trueVel = state.velocity;

    const mstate = getInterpolatedState(NASA_MOON, moonVelocities, simDay);
    moonPos = mstate.position.multiplyScalar(SCALE);
  } else {
    const state = getWarpedVisualPosition(NASA_TRAJ, orionVelocities, simDay);
    orionPos = state.position;
    trueVel = state.trueVelocity;

    const moonState = getInterpolatedState(NASA_MOON, moonVelocities, simDay);
    const dir_moon = moonState.position.clone().normalize();
    moonPos = dir_moon.multiplyScalar(45); // Moon fixed at 45 units in visual scale
  }

  // 3. Update 3D Positions in WebGL Scene
  orionGroup.position.copy(orionPos);
  moonGroup.position.copy(moonPos);

  // Orion rotation (points along velocity vector direction)
  const nextDay = Math.min(simDay + 0.003, TRAJ_END_DAY);
  let nextPos;
  if (trueScale) {
    nextPos = getInterpolatedState(NASA_TRAJ, orionVelocities, nextDay).position.multiplyScalar(SCALE);
  } else {
    nextPos = getWarpedVisualPosition(NASA_TRAJ, orionVelocities, nextDay).position;
  }
  const travelDir = new THREE.Vector3().subVectors(nextPos, orionPos).normalize();
  orionGroup.lookAt(orionPos.clone().add(travelDir));

  // Earth rotation (approximate GMST rotation)
  const simMs = LAUNCH_TIME + simDay * 86400000;
  const dJ2000 = (simMs - J2000_MS) / 86400000;
  const gmstDeg = (280.46061837 + 360.98564736629 * dJ2000) % 360;
  earthMesh.rotation.y = gmstDeg * Math.PI / 180;

  // Rotate moon around its axis
  moonMesh.rotation.y = (simDay * (360 / 27.3)) * Math.PI / 180; // Bound rotation locked with Earth

  // 4. Update Trajectory Paths Lines (throttled)
  const flatPts = trueScale ? flatTrajTrue : flatTrajVisual;
  const numTrajPts = flatPts.length / 3;
  const trailIndex3 = Math.floor(currentDataIndex * LINE_SUBDIV); // subdivision-aligned index
  const trailIndex = Math.min(numTrajPts - 1, trailIndex3);
  const apogeeSubIdx = Math.min(numTrajPts - 1, APOGEE_INDEX * LINE_SUBDIV);

  const showOutbound = document.getElementById('check-outbound').checked;
  const showInbound = document.getElementById('check-inbound').checked;
  const showTrails = document.getElementById('check-trails').checked;

  if (showTrails) {
    traveledLine.visible = true;
    if (trailIndex !== lastTrailIndex) {
      lastTrailIndex = trailIndex;
      const traveledCount = Math.max(2, trailIndex);
      if (traveledCount >= 2) {
        traveledLine.geometry.setPositions(flatPts.subarray(0, traveledCount * 3));
        traveledLine.computeLineDistances();
      }
      // Build projected line respecting outbound/inbound toggles
      let projStart = trailIndex;
      let projEnd = numTrajPts;
      if (!showOutbound && trailIndex < apogeeSubIdx) projStart = apogeeSubIdx;
      if (!showInbound) projEnd = Math.min(projEnd, apogeeSubIdx);
      if (!showOutbound && !showInbound) projStart = numTrajPts;
      const projCount = Math.max(0, projEnd - projStart);
      if (projCount >= 2) {
        projectedLine.visible = true;
        projectedLine.geometry.setPositions(flatPts.subarray(projStart * 3, projEnd * 3));
        projectedLine.computeLineDistances();
      } else {
        projectedLine.visible = false;
      }
    }
  } else {
    traveledLine.visible = false;
    projectedLine.visible = false;
    lastTrailIndex = -1;
  }

  // Earth-Moon distance indicator line
  if (document.getElementById('check-orbit-guides').checked) {
    emLine.visible = true;
    emLine.geometry.setFromPoints([
      new THREE.Vector3(0, 0, 0),
      moonPos
    ]);
    emLine.computeLineDistances();
    gridFloor.visible = true;
  } else {
    emLine.visible = false;
    gridFloor.visible = false;
  }

  // 5. Checkbox visibility for 3D Labels
  const showLabels = document.getElementById('check-labels').checked;
  earthLabel.visible = showLabels;
  moonLabel.visible = showLabels;
  orionLabel.visible = showLabels;
  scene.children.forEach(child => {
    if (child instanceof THREE.Sprite && child.userData && child.userData.index !== undefined) {
      child.visible = showLabels;
    }
  });

  // Reposition labels to face camera
  earthLabel.lookAt(camera.position);
  moonLabel.lookAt(camera.position);
  orionLabel.lookAt(camera.position);
  updateCheckpointLabels();

  // Pulse beacon sprite flare
  const camDist = camera.position.distanceTo(orionPos);
  const fade = Math.min(1.0, camDist / 4);
  beaconSprite.material.opacity = fade * (0.65 + 0.35 * Math.sin(now * 0.005));

  // 6. Camera Transitions (Focus tracking)
  if (targetPos) {
    camera.position.lerp(targetPos, 0.045);
    controls.target.lerp(targetLook, 0.045);
    if (camera.position.distanceTo(targetPos) < 0.2) {
      targetPos = null;
      targetLook = null;
    }
  }

  if (!targetPos) {
    if (cameraMode === 'follow') {
      const offset = camera.position.clone().sub(controls.target);
      controls.target.copy(orionPos);
      camera.position.copy(orionPos).add(offset);
    } else if (cameraMode === 'moon') {
      const offset = camera.position.clone().sub(controls.target);
      controls.target.copy(moonPos);
      camera.position.copy(moonPos).add(offset);
    }
  }

  controls.update();

  // 7. Update HUD Telemetry text
  const elapsedMs = simDay * 86400000;
  
  // MET formatting
  const metD = Math.floor(simDay);
  const metH = Math.floor((elapsedMs % 86400000) / 3600000);
  const metM = Math.floor((elapsedMs % 3600000) / 60000);
  const metS = Math.floor((elapsedMs % 60000) / 1000);
  
  const metString = `T+${metD}/${String(metH).padStart(2,'0')}:${String(metM).padStart(2,'0')}:${String(metS).padStart(2,'0')}`;
  document.getElementById('telemetry-met').textContent = metString;
  document.getElementById('hud-met-label').textContent = `MET ${metString}`;

  // UTC formatting
  const currentUtc = new Date(LAUNCH_TIME + elapsedMs);
  document.getElementById('telemetry-utc').textContent = currentUtc.toUTCString().replace('GMT', 'UTC');

  // Earth/Moon Ranges and Velocity
  const rawOrion = NASA_TRAJ[Math.floor(currentDataIndex)];
  const rawMoon = NASA_MOON[Math.floor(currentDataIndex)];
  
  const earthDist = new THREE.Vector3(rawOrion[0], rawOrion[1], rawOrion[2]).length();
  const moonDist = new THREE.Vector3(rawOrion[0] - rawMoon[0], rawOrion[1] - rawMoon[1], rawOrion[2] - rawMoon[2]).length() - MOON_RADIUS;
  
  const velVal = trueVel.length(); // speed in km/s

  document.getElementById('telemetry-earth-range').textContent = Math.round(earthDist).toLocaleString('en-US');
  document.getElementById('telemetry-moon-range').textContent = Math.round(moonDist).toLocaleString('en-US');

  // Chart parameters text
  document.getElementById('chart-val-velocity').textContent = velVal.toFixed(2);
  document.getElementById('chart-val-earth').textContent = Math.round(earthDist).toLocaleString('en-US');
  document.getElementById('chart-val-moon').textContent = Math.round(moonDist).toLocaleString('en-US');

  // Active Phase calculation
  let phaseName = 'Entry preparation';
  let eventName = 'Translunar Coast';
  let eventDesc = 'Orion is in the outbound translunar coast phase, heading towards the Moon after a successful Translunar Injection (TLI) burn.';
  
  if (simDay < 0.141875) {
    phaseName = 'High Earth Orbit';
    eventName = 'Earth Orbit Coast';
    eventDesc = 'Verify systems integrity in High Earth Orbit prior to executing TLI.';
  } else if (simDay < 1.05125) {
    phaseName = 'High Earth Orbit';
    eventName = 'Orion / ICPS Separation';
    eventDesc = 'Orion separates from the SLS ICPS stage, testing spacecraft parameters and manual proximity operations.';
  } else if (simDay < 4.29412) {
    phaseName = 'Translunar Coast';
    eventName = 'Translunar Injection';
    eventDesc = 'TLI burn completed successfully. Orion departs Earth orbit towards the Moon at approximately 10.4 km/s.';
  } else if (simDay < 5.01792) {
    phaseName = 'Lunar SOI Entry';
    eventName = 'Lunar SOI Entry';
    eventDesc = 'Orion enters the lunar gravitational Sphere of Influence at ~66,000 km. Lunar pull becomes primary acceleration factor.';
  } else if (simDay < 5.02069) {
    phaseName = 'Closest Lunar Approach';
    eventName = 'Closest Lunar Approach';
    eventDesc = 'Orion swings behind the far side of the Moon at 6,545 km surface altitude, using Moon gravity to slide back to Earth.';
  } else if (simDay < 6.50000) {
    phaseName = 'Return Coast';
    eventName = 'Deep Space Record';
    eventDesc = 'Orion reaches apogee of 413,146 km, breaking Apollo 13 record for furthest human-crewed distance from Earth.';
  } else if (simDay < TRAJ_END_DAY) {
    phaseName = 'Return Transit';
    eventName = 'RTC-1 Return Burn';
    eventDesc = 'RTC correction burn aligns entry path interface angles to prevent skipping off Earth atmosphere.';
  } else {
    phaseName = 'Splashdown';
    eventName = 'Atmospheric Entry';
    eventDesc = 'Orion enters atmospheric boundary layer at 11 km/s, utilizing skip entry profiles to brake velocity.';
  }

  document.getElementById('telemetry-phase').textContent = phaseName;
  document.getElementById('event-title').textContent = eventName;
  document.getElementById('event-desc').textContent = eventDesc;

  // Active queue highlight
  document.querySelectorAll('.queue-item').forEach((item, idx) => {
    const phase = MISSION_PHASES[idx];
    const nextPhase = MISSION_PHASES[idx + 1];
    const isCurrent = simDay >= phase.day && (!nextPhase || simDay < nextPhase.day);
    item.classList.toggle('active', isCurrent);
  });

  // Timeline slider fill percentage updates
  if (!isScrubbing) {
    const timeTotal = TRAJ_END_DAY - TRAJ_START_DAY;
    const pct = Math.max(0, Math.min(100, ((simDay - TRAJ_START_DAY) / timeTotal) * 100));
    document.getElementById('timeline-range').value = pct * 100;
    document.getElementById('timeline-fill').style.width = `${pct}%`;
  }

  // 8. Render 2D telemetry charts
  handleChartsRender(currentDataIndex);

  // 9. Update 2D Overview Map
  updateActiveCoRotatingPath(currentDataIndex);

  // 10. WebGL Render Pass
  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════
// ENTRY INITIALIZATION
// ═══════════════════════════════════════════
function start() {
  // Precompute state derivatives (velocities)
  orionVelocities = computeVelocities(NASA_TRAJ);
  moonVelocities = computeVelocities(NASA_MOON);

  // Precompute SVG co-rotating trajectory loop path
  buildCoRotatingTrajectoryPath();

  // Setup Three.js WebGL scene
  initScene();

  // Build full coordinate point sequences for lines
  buildLinePoints();

  // Precompute data limits for charts
  precomputeChartsData();

  // Setup High DPI Canvases
  setupCanvasHighDPI('chart-velocity');
  setupCanvasHighDPI('chart-earth');
  setupCanvasHighDPI('chart-moon');

  // Place labels at specific orbit index points
  initScene3DLabels();

  // Setup bottom playback UI controllers
  setupPlaybackUI();

  // Set default view focus
  setCameraFocus('overview');

  // Trigger main animation loop
  render();
}

// Handle canvas resizing for graphs on layout changes
window.addEventListener('resize', () => {
  setupCanvasHighDPI('chart-velocity');
  setupCanvasHighDPI('chart-earth');
  setupCanvasHighDPI('chart-moon');
});

// Run start
start();
