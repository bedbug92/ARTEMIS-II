import * as THREE from 'three';
import { TRAJ_START_DAY, TRAJ_STEP_DAYS } from '../data/trajectory.js';

const DT = TRAJ_STEP_DAYS * 86400; // Step size in seconds (600s)

// Precomputes velocities at each node using central differences
export function computeVelocities(positions) {
  const N = positions.length;
  const velocities = new Array(N);

  for (let i = 0; i < N; i++) {
    let vx, vy, vz;
    if (i === 0) {
      // Forward difference at start boundary
      vx = (positions[1][0] - positions[0][0]) / DT;
      vy = (positions[1][1] - positions[0][1]) / DT;
      vz = (positions[1][2] - positions[0][2]) / DT;
    } else if (i === N - 1) {
      // Backward difference at end boundary
      vx = (positions[N - 1][0] - positions[N - 2][0]) / DT;
      vy = (positions[N - 1][1] - positions[N - 2][1]) / DT;
      vz = (positions[N - 1][2] - positions[N - 2][2]) / DT;
    } else {
      // Central difference
      vx = (positions[i + 1][0] - positions[i - 1][0]) / (2 * DT);
      vy = (positions[i + 1][1] - positions[i - 1][1]) / (2 * DT);
      vz = (positions[i + 1][2] - positions[i - 1][2]) / (2 * DT);
    }
    velocities[i] = [vx, vy, vz];
  }
  return velocities;
}

// Convert coordinates from Horizons J2000 Ecliptic to Three.js coordinate system.
// JPL Horizons uses (X, Y, Z) where Z is normal to the ecliptic plane, Y is towards spring equinox, etc.
// In Three.js, it is common to map X -> X, Z -> Y, -Y -> Z to make Y the "up" vector in standard scenes,
// or we can map them directly as: ThreeX = X, ThreeY = Z, ThreeZ = -Y.
// Let's stick to the mapping used in the reference project: (x, z, -y).
// That is: ThreeX = x, ThreeY = z, ThreeZ = -y.
export function horizonsToThree(x, y, z) {
  return new THREE.Vector3(x, z, -y);
}

// Hermite cubic spline interpolation for position and velocity at any day of the mission.
export function getInterpolatedState(positions, velocities, day) {
  const N = positions.length;
  
  // Clamp to boundaries
  if (day <= TRAJ_START_DAY) {
    const pos = horizonsToThree(positions[0][0], positions[0][1], positions[0][2]);
    const vel = horizonsToThree(velocities[0][0], velocities[0][1], velocities[0][2]);
    return { position: pos, velocity: vel };
  }
  
  const maxDay = TRAJ_START_DAY + (N - 1) * TRAJ_STEP_DAYS;
  if (day >= maxDay) {
    const pos = horizonsToThree(positions[N - 1][0], positions[N - 1][1], positions[N - 1][2]);
    const vel = horizonsToThree(velocities[N - 1][0], velocities[N - 1][1], velocities[N - 1][2]);
    return { position: pos, velocity: vel };
  }

  // Find surrounding nodes
  const fIdx = (day - TRAJ_START_DAY) / TRAJ_STEP_DAYS;
  const i = Math.floor(fIdx);
  const tau = fIdx - i; // Fractional part in [0, 1]

  const p0_raw = positions[i];
  const p1_raw = positions[i + 1];
  const v0_raw = velocities[i];
  const v1_raw = velocities[i + 1];

  // Convert to Three.js coordinates
  const p0 = horizonsToThree(p0_raw[0], p0_raw[1], p0_raw[2]);
  const p1 = horizonsToThree(p1_raw[0], p1_raw[1], p1_raw[2]);
  const v0 = horizonsToThree(v0_raw[0], v0_raw[1], v0_raw[2]);
  const v1 = horizonsToThree(v1_raw[0], v1_raw[1], v1_raw[2]);

  // Tangents scaled by interval length DT
  const m0 = v0.clone().multiplyScalar(DT);
  const m1 = v1.clone().multiplyScalar(DT);

  // Hermite basis functions
  const tau2 = tau * tau;
  const tau3 = tau2 * tau;

  const h00 = 2 * tau3 - 3 * tau2 + 1;
  const h10 = tau3 - 2 * tau2 + tau;
  const h01 = -2 * tau3 + 3 * tau2;
  const h11 = tau3 - tau2;

  // Interpolated Position
  const position = new THREE.Vector3()
    .addScaledVector(p0, h00)
    .addScaledVector(m0, h10)
    .addScaledVector(p1, h01)
    .addScaledVector(m1, h11);

  // Derivative of Hermite basis functions with respect to tau
  const dh00 = 6 * tau2 - 6 * tau;
  const dh10 = 3 * tau2 - 4 * tau + 1;
  const dh01 = -6 * tau2 + 6 * tau;
  const dh11 = 3 * tau2 - 2 * tau;

  // Interpolated Velocity (dPosition/dTime = dPosition/dTau * dTau/dTime = dPosition/dTau / DT)
  const velocity = new THREE.Vector3()
    .addScaledVector(p0, dh00)
    .addScaledVector(m0, dh10)
    .addScaledVector(p1, dh01)
    .addScaledVector(m1, dh11)
    .multiplyScalar(1 / DT);

  return { position, velocity };
}
