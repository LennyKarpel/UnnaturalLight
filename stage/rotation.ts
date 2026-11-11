// The little 3D math the stage model needs: vectors, rotations (quaternions)
// and yaw / pitch / roll angles. No three.js, so the model runs (and is
// tested) in Node; view3d.ts turns these into three.js objects to draw.
//
// The formulas are three.js's own (Euler order "YXZ": yaw about y, then pitch
// about x, then roll about z), so the numbers match what the stage drew
// before; test/data/stage-geometry.json checks that.

export type Vec = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const vec = (x: number, y: number, z: number): Vec => ({ x, y, z });
export const add = (a: Vec, b: Vec): Vec => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec, b: Vec): Vec => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec, s: number): Vec => vec(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec, b: Vec): Vec => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lengthSq = (a: Vec) => dot(a, a);
export function normalize(a: Vec): Vec {
  const n = Math.sqrt(lengthSq(a));
  return n ? scale(a, 1 / n) : vec(0, 0, 0);
}

/** A rotation from angles in radians (x = pitch, y = yaw, z = roll; order YXZ). */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
}

/** `a` then `b` in `a`'s frame (three.js's a.multiply(b)). */
export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** The opposite rotation (of a unit quaternion). */
export const invertQuat = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** `v` rotated by `q`. */
export function rotate(v: Vec, q: Quat): Vec {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return vec(
    v.x + q.w * tx + q.y * tz - q.z * ty,
    v.y + q.w * ty + q.z * tx - q.x * tz,
    v.z + q.w * tz + q.x * ty - q.y * tx,
  );
}

/** A rotation matrix's rows: [[m11, m12, m13], [m21, m22, m23], [m31, m32, m33]]. */
type Matrix = [[number, number, number], [number, number, number], [number, number, number]];

/** Angles in radians (x = pitch, y = yaw, z = roll; order YXZ) of a rotation matrix. */
function eulerFromMatrix([[m11, , m13], [m21, m22, m23], [m31, , m33]]: Matrix): Vec {
  const x = Math.asin(-Math.min(1, Math.max(-1, m23)));
  return Math.abs(m23) < 0.9999999 ? vec(x, Math.atan2(m13, m33), Math.atan2(m21, m22)) : vec(x, Math.atan2(-m31, m11), 0);
}

/** Angles in radians (x = pitch, y = yaw, z = roll; order YXZ) of a rotation. */
export function eulerFromQuat({ x, y, z, w }: Quat): Vec {
  const xx = x * x * 2, yy = y * y * 2, zz = z * z * 2;
  const xy = x * y * 2, xz = x * z * 2, yz = y * z * 2;
  const wx = w * x * 2, wy = w * y * 2, wz = w * z * 2;
  return eulerFromMatrix([
    [1 - (yy + zz), xy - wz, xz + wy],
    [xy + wz, 1 - (xx + zz), yz - wx],
    [xz - wy, yz + wx, 1 - (xx + yy)],
  ]);
}

/** Angles in radians (order YXZ) of the frame whose local x, y, z axes are `right`, `up`, `back`. */
export function eulerFromAxes(right: Vec, up: Vec, back: Vec): Vec {
  return eulerFromMatrix([
    [right.x, up.x, back.x],
    [right.y, up.y, back.y],
    [right.z, up.z, back.z],
  ]);
}
