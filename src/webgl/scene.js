import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

// Scale and Physical Constants
export const SCALE = 1 / 4000; // 1 unit in 3D scene = 4000 km in real life
export const EARTH_RADIUS = 6371; // km
export const MOON_RADIUS = 1737; // km

const eR_scaled = EARTH_RADIUS * SCALE;
const mR_scaled = MOON_RADIUS * SCALE;

export let scene, camera, renderer, controls;
export let earthGroup, earthMesh, earthTiltGroup, moonGroup, moonMesh, orionGroup, orionMesh;
export let traveledLine, projectedLine, emLine, gridFloor;
export let earthLabel, moonLabel, orionLabel;
export let beaconSprite;

let container;

// Procedural texture generators for futuristic sci-fi visual style
function generateProceduralEarthTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Deep space-blue background
  ctx.fillStyle = '#050a24';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw grid lines (longitude)
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.18)';
  ctx.lineWidth = 1;
  const numLong = 36;
  for (let i = 0; i <= numLong; i++) {
    const x = (i / numLong) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  // Draw grid lines (latitude)
  const numLat = 18;
  for (let i = 0; i <= numLat; i++) {
    const y = (i / numLat) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Generate stylized "continent outlines" using glowing cyan pixels
  ctx.fillStyle = 'rgba(0, 212, 255, 0.45)';
  let seedVal = 12345;
  const rand = () => { seedVal = (seedVal * 1103515245 + 12345) & 0x7fffffff; return seedVal / 0x7fffffff; };
  const drawStylizedLand = (cx, cy, w, h) => {
    ctx.beginPath();
    const r = 6;
    ctx.moveTo(cx + r, cy);
    ctx.lineTo(cx + w - r, cy);
    ctx.arcTo(cx + w, cy, cx + w, cy + r, r);
    ctx.arcTo(cx + w, cy + h, cx + w - r, cy + h, r);
    ctx.arcTo(cx, cy + h, cx, cy + h - r, r);
    ctx.arcTo(cx, cy, cx + r, cy, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 255, 136, 0.7)';
    for (let k = 0; k < 6; k++) {
      const sx = cx + rand() * (w - 12);
      const sy = cy + rand() * (h - 12);
      ctx.fillRect(sx, sy, 8, 8);
    }
    ctx.fillStyle = 'rgba(0, 212, 255, 0.45)';
  };

  // Draw continent approximations
  drawStylizedLand(100, 100, 150, 180); // North America
  drawStylizedLand(200, 250, 120, 150); // South America
  drawStylizedLand(450, 120, 130, 160); // Africa
  drawStylizedLand(430, 50, 300, 100);  // Eurasia
  drawStylizedLand(720, 120, 120, 160); // East Asia / China area
  drawStylizedLand(780, 300, 100, 80);  // Australia
  drawStylizedLand(150, 420, 700, 40);  // Antarctica

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function generateProceduralMoonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Gray base background
  ctx.fillStyle = '#1e2024';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  const numGrid = 24;
  for (let i = 0; i <= numGrid; i++) {
    const x = (i / numGrid) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let i = 0; i <= numGrid / 2; i++) {
    const y = (i / (numGrid / 2)) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw craters (circles with light borders and dark shadows)
  const drawCrater = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();
  };

  // Scatter craters
  const seededRandom = (function(s) {
    return function() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  })(42);
  for (let i = 0; i < 40; i++) {
    const x = seededRandom() * canvas.width;
    const y = seededRandom() * canvas.height;
    const r = 4 + seededRandom() * 12;
    drawCrater(x, y, r);
  }

  return new THREE.CanvasTexture(canvas);
}

// 3D Text billboard sprites
export function create3DLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  ctx.font = '600 24px Space Grotesk, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  // Subtle text shadow for sci-fi HUD glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fillText(text, 256, 40);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ 
    map: texture, 
    transparent: true, 
    opacity: 0.85, 
    depthWrite: false 
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6, 0.75, 1);
  return sprite;
}

// Faded reference grid floor on the J2000 Ecliptic plane
function createFadedGridFloor() {
  const size = 300; // total width/length in meters
  const divisions = 60;
  const step = size / divisions;
  const halfSize = size / 2;

  const positions = [];
  const colors = [];

  const baseColor = new THREE.Color(0x0055aa);
  const fadeDistance = 120; // grid fades out beyond this distance

  for (let i = 0; i <= divisions; i++) {
    // Grid lines along Z
    const x = -halfSize + i * step;
    positions.push(x, 0, -halfSize, x, 0, halfSize);
    
    // Grid lines along X
    const z = -halfSize + i * step;
    positions.push(-halfSize, 0, z, halfSize, 0, z);
  }

  // Calculate vertex colors with radial alpha fading
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i];
    const pz = positions[i + 2];
    const dist = Math.sqrt(px * px + pz * pz);
    
    const alpha = Math.max(0, 1 - dist / fadeDistance);
    const color = baseColor.clone().multiplyScalar(alpha * 0.45);
    colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false
  });

  return new THREE.LineSegments(geometry, material);
}

// Create Orion's beacon sprite (pulsing orange flare)
function createBeaconSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 120, 50, 0.95)');
  grad.addColorStop(0.2, 'rgba(255, 90, 30, 0.65)');
  grad.addColorStop(0.5, 'rgba(255, 60, 20, 0.15)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.5, 1.5, 1);
  return sprite;
}

export function initScene() {
  container = document.getElementById('canvas-container');
  
  // 1. Create Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030611, 0.0001);

  // 2. Camera Setup
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 8000);
  camera.position.set(70, 45, 110);

  // 3. Renderer Setup
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  // 4. OrbitControls Setup
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.4;
  controls.maxDistance = 1000;
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  // 5. Starfield Background
  (() => {
    const N = 15000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 1200 + Math.random() * 2000;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i*3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i*3+2] = r * Math.cos(phi);
      
      const intensity = 0.4 + Math.random() * 0.6;
      col[i*3] = intensity * 0.95;
      col[i*3+1] = intensity * 0.98;
      col[i*3+2] = intensity;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const material = new THREE.PointsMaterial({
      size: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending
    });
    scene.add(new THREE.Points(geometry, material));
  })();

  // 6. Lights
  const ambientLight = new THREE.AmbientLight(0x0e1424, 0.85);
  scene.add(ambientLight);

  const sunAngle = Math.atan2(-0.15, 0.97);
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
  sunLight.position.set(Math.cos(sunAngle) * 500, 30, Math.sin(sunAngle) * 500);
  scene.add(sunLight);

  // 7. Reference Grid Floor
  gridFloor = createFadedGridFloor();
  scene.add(gridFloor);

  // 8. Earth Setup (with axial tilt ~23.44° relative to ecliptic)
  earthGroup = new THREE.Group();

  // Tilt group rotates the ecliptic normal to Earth's rotation axis
  earthTiltGroup = new THREE.Group();
  earthTiltGroup.rotation.x = -23.44 * Math.PI / 180; // Earth axial tilt
  earthGroup.add(earthTiltGroup);

  const earthGeo = new THREE.SphereGeometry(eR_scaled, 64, 64);
  const earthMat = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0.1,
    emissive: 0x0c1328,
    emissiveIntensity: 0.2
  });
  earthMat.map = generateProceduralEarthTexture();

  earthMesh = new THREE.Mesh(earthGeo, earthMat);
  earthTiltGroup.add(earthMesh);

  // Holographic Atmosphere Shader Glow
  const atmosGeo = new THREE.SphereGeometry(eR_scaled * 1.035, 64, 32);
  const atmosMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
    uniforms: {
      glowColor: { value: new THREE.Color(0x00d4ff) },
      coeff: { value: 0.45 },
      power: { value: 3.8 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float coeff;
      uniform float power;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float rim = 1.0 - max(0.0, dot(viewDir, vNormal));
        float intensity = coeff * pow(rim, power);
        gl_FragColor = vec4(glowColor, intensity * 0.18);
      }
    `
  });
  earthTiltGroup.add(new THREE.Mesh(atmosGeo, atmosMat));

  earthLabel = create3DLabel('EARTH', '#00bbff');
  earthLabel.position.set(0, eR_scaled + 2.8, 0);
  earthGroup.add(earthLabel);

  scene.add(earthGroup);

  // 9. Moon Setup
  moonGroup = new THREE.Group();

  const moonGeo = new THREE.SphereGeometry(mR_scaled, 64, 32);
  const moonMat = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0.05,
    emissive: 0x0a0a0c,
    emissiveIntensity: 0.15
  });
  moonMat.map = generateProceduralMoonTexture();

  moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonGroup.add(moonMesh);

  moonLabel = create3DLabel('MOON', '#ccccdd');
  moonLabel.position.set(0, mR_scaled + 1.8, 0);
  moonGroup.add(moonLabel);

  scene.add(moonGroup);

  // 10. Trajectory Paths Line Setup
  // Traveled / active trajectory (thick glowing line)
  const traveledMat = new LineMaterial({
    color: 0x00d4ff, // Cyan
    linewidth: 3,
    transparent: true,
    opacity: 0.95,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
  });
  const traveledGeo = new LineGeometry();
  // Init with dummy segment
  traveledGeo.setPositions([0, 0, 0, 0.001, 0, 0]);
  traveledLine = new Line2(traveledGeo, traveledMat);
  traveledLine.computeLineDistances();
  scene.add(traveledLine);

  // Predicted trajectory (dotted or thinner blue)
  const projectedMat = new LineMaterial({
    color: 0x0055aa, // Dim dark blue
    linewidth: 1.5,
    transparent: true,
    opacity: 0.5,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
  });
  const projectedGeo = new LineGeometry();
  // Init with dummy segment
  projectedGeo.setPositions([0, 0, 0, 0.001, 0, 0]);
  projectedLine = new Line2(projectedGeo, projectedMat);
  projectedLine.computeLineDistances();
  scene.add(projectedLine);

  // Earth-Moon connecting line
  emLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
      dashSize: 2,
      gapSize: 1.5
    })
  );
  scene.add(emLine);

  // 11. Orion Group Setup
  orionGroup = new THREE.Group();

  // Load the downloaded STL 3D Model
  const loader = new STLLoader();
  loader.load('/orion.stl', (geometry) => {
    geometry.computeVertexNormals();
    geometry.center();

    const orionMaterial = new THREE.MeshStandardMaterial({
      color: 0xd0d0d8,
      roughness: 0.3,
      metalness: 0.75,
      emissive: 0x223344,
      emissiveIntensity: 0.25
    });

    const mesh = new THREE.Mesh(geometry, orionMaterial);
    const s = 0.00018; // scaled to fit visually
    mesh.scale.set(s, s, s);
    mesh.rotation.x = Math.PI; // Correct model orientation
    orionGroup.add(mesh);
    orionMesh = mesh;
  }, undefined, (err) => {
    console.error("STLLoader failed, falling back to simple box spacecraft representation:", err);
    // Fallback simple 3D shape if STL loading fails
    const geom = new THREE.ConeGeometry(0.12, 0.35, 8);
    geom.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x99aab5, metalness: 0.8, roughness: 0.2 });
    const fallbackMesh = new THREE.Mesh(geom, mat);
    orionGroup.add(fallbackMesh);
  });

  // Adding flare sprite to Orion
  beaconSprite = createBeaconSprite();
  orionGroup.add(beaconSprite);

  // Orion Label
  orionLabel = create3DLabel('ORION', '#ff8844');
  orionLabel.position.set(0, 0.4, 0);
  orionGroup.add(orionLabel);

  scene.add(orionGroup);

  // Handle Resize Event
  window.addEventListener('resize', handleWindowResize);
}

function handleWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  
  // Update thick line resolutions
  if (traveledLine && traveledLine.material) {
    traveledLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
  if (projectedLine && projectedLine.material) {
    projectedLine.material.resolution.set(window.innerWidth, window.innerHeight);
  }
}
