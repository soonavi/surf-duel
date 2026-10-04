import * as THREE from 'three';

/**
 * Triangular-prism surf ramp running from z = 0 to z = -length, peak on the
 * centreline at y = height, base at y = 0. Both slopes rise at `angleDeg`
 * from horizontal, so anything steeper than ~45.6° is surfable.
 *
 * Non-indexed so `computeVertexNormals` gives flat per-face normals.
 */
export function rampPrismGeometry(length: number, height: number, angleDeg: number): THREE.BufferGeometry {
  const halfWidth = height / Math.tan(THREE.MathUtils.degToRad(angleDeg));
  const A = [0, height, 0]; // peak, front
  const D = [0, height, -length]; // peak, back
  const B = [-halfWidth, 0, 0]; // left base, front
  const C = [-halfWidth, 0, -length]; // left base, back
  const E = [halfWidth, 0, 0]; // right base, front
  const F = [halfWidth, 0, -length]; // right base, back

  // Counter-clockwise winding, viewed from outside.
  const tris = [
    [A, C, B], [A, D, C], // left slope
    [A, E, F], [A, F, D], // right slope
    [A, B, E], // front cap
    [D, F, C], // back cap
    [B, C, F], [B, F, E], // bottom
  ];
  const positions = new Float32Array(tris.flat(2));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
