// Held items (props) as simple stand-ins built from the catalog (src/prop-catalog.js):
// neutral grey shapes, lighter grey blades, and an orange marker on the muzzle / blade tip / shield front.
// They are attached to the hands after the body is posed, so the grip shows in the reference image.
import * as THREE from 'three';
import { propDef } from './prop-catalog.js';

const MATS = {
  dark: new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.2 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xb8bfc7, roughness: 0.3, metalness: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x77726c, roughness: 0.7 }),
  tip: new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.4, emissive: 0x552200 }),
};
const mat = (p) => MATS[p.mat] || MATS.dark;

function mesh(geo, p, x, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(p));
  m.position.set(x, y, z);
  return m;
}

/** Geometry of one item in its local frame (see prop-catalog.js), length L in head heights. */
export function propShape(def, L, width) {
  const g = new THREE.Group();
  const scaleW = width && def.width ? width / def.width : 1;
  for (const p of def.parts || []) {
    const [a, b] = Array.isArray(p.x) ? p.x : [p.x || 0, p.x || 0];
    switch (p.shape) {
      case 'box':
        g.add(mesh(new THREE.BoxGeometry(Math.max(1e-3, (b - a) * L), p.h, p.w), p, ((a + b) / 2) * L, p.y || 0, p.z || 0));
        break;
      case 'cyl':
        g.add(mesh(new THREE.CylinderGeometry(p.r2 ?? p.r, p.r, Math.max(1e-3, (b - a) * L), 18).rotateZ(-Math.PI / 2), p, ((a + b) / 2) * L, p.y || 0, p.z || 0));
        break;
      case 'ball':
        g.add(mesh(new THREE.SphereGeometry(p.r, 16, 12), p, a * L, p.y || 0, p.z || 0));
        break;
      case 'blade': {
        const len = (b - a) * L;
        const tip = Math.min(len, (p.tipLen ?? 0.1) * len);
        if (len - tip > 1e-3) g.add(mesh(new THREE.BoxGeometry(len - tip, p.w, p.t), p, a * L + (len - tip) / 2, p.y || 0));
        const tri = new THREE.Shape([new THREE.Vector2(0, -p.w / 2), new THREE.Vector2(tip, 0), new THREE.Vector2(0, p.w / 2)]);
        const geo = new THREE.ExtrudeGeometry(tri, { depth: p.t, bevelEnabled: false }).translate(0, 0, -p.t / 2);
        g.add(mesh(geo, p.tipMat === false ? p : { ...p, mat: 'tip' }, b * L - tip, p.y || 0)); // the point is the orange marker
        break;
      }
      case 'disc': {
        const r = p.r * (L / def.length);
        g.add(mesh(new THREE.CylinderGeometry(r, r, p.t, 40), p, p.x || 0, p.y || 0, p.z || 0));
        break;
      }
      case 'plate':
        g.add(mesh(new THREE.BoxGeometry(p.h * (L / def.length), p.t, p.w * scaleW), p, p.x || 0, p.y || 0, p.z || 0));
        break;
      case 'kite': {
        const h = p.h * (L / def.length);
        const w = p.w * scaleW;
        const pts = [[h / 2, -w * 0.38], [h / 2 - h * 0.08, -w / 2], [-h * 0.1, -w * 0.45], [-h / 2, 0], [-h * 0.1, w * 0.45], [h / 2 - h * 0.08, w / 2], [h / 2, w * 0.38]];
        const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))), { depth: p.t, bevelEnabled: false })
          .rotateX(Math.PI / 2).translate(0, p.t / 2, 0);
        g.add(mesh(geo, p, p.x || 0, p.y || 0, p.z || 0));
        break;
      }
      default:
        throw new Error(`unknown prop part shape '${p.shape}' in ${def.type}`);
    }
  }
  return g;
}

const orth = (v, axis) => v.clone().sub(axis.clone().multiplyScalar(v.dot(axis)));

/**
 * Build the props of a pose. hand(side) returns, in world space:
 *   { pos: palm centre, wrist, elbow, along: forearm direction (elbow -> palm),
 *     quat: hand rotation (fingers -Y, thumb +Z, back of the hand +X on the left / -X on the right),
 *     foreQuat: forearm rotation (same axes) }
 * `up` is the body's up direction. Returns { group, info[] } (info is used by the description).
 */
export function buildProps(props, hand, up) {
  const group = new THREE.Group();
  const info = [];
  for (const p of props || []) {
    const def = propDef(p.type);
    if (!def) continue;
    const L = p.length ?? def.length;
    const side = p.hands[0];
    const s = side === 'left' ? 1 : -1;
    const main = hand(side);
    let mode = def.attach;
    if (mode === 'axis' && p.hands.length < 2) mode = def.oneHand || 'forearm';
    const backOfHand = (q) => new THREE.Vector3(s, 0, 0).applyQuaternion(q).normalize();
    const turn = (v, q) => (p.angle ? v.clone().applyAxisAngle(backOfHand(q), THREE.MathUtils.degToRad(p.angle)) : v);
    const item = propShape(def, L, p.width);

    if (mode === 'strap') {
      const q = main.foreQuat;
      const normal = backOfHand(q);
      const long = turn(new THREE.Vector3(0, 0, 1).applyQuaternion(q), q).normalize();
      const across = new THREE.Vector3().crossVectors(long, normal);
      const center = main.elbow.clone().lerp(main.wrist, 0.55).add(normal.clone().multiplyScalar(0.3));
      item.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(long, normal, across));
      item.position.copy(center);
      group.add(item);
      info.push({ ...p, def, label: def.label, category: def.category, mode, normal, center, long });
      continue;
    }

    let axis;
    let top;
    if (mode === 'axis') {
      const sup = hand(p.hands[1]);
      axis = sup.pos.clone().sub(main.pos);
      if ((def.support ?? 1) < def.grip) axis.negate(); // second hand behind the grip (two-handed swords)
    } else if (mode === 'thumb') {
      axis = turn(new THREE.Vector3(0, 0, 1).applyQuaternion(main.quat), main.quat);
    } else {
      axis = main.along.clone();
    }
    if (axis.lengthSq() < 1e-8) axis = new THREE.Vector3(0, 0, 1);
    axis.normalize();
    if (def.category === 'blade') top = new THREE.Vector3(0, -1, 0).applyQuaternion(main.quat); // edge toward the fingers
    else top = up.clone();
    top = orth(top, axis);
    if (top.lengthSq() < 1e-4) top = orth(new THREE.Vector3(0, 0, 1), axis);
    if (top.lengthSq() < 1e-4) top = orth(new THREE.Vector3(1, 0, 0), axis);
    top.normalize();
    const sideV = new THREE.Vector3().crossVectors(axis, top);
    const back = main.pos.clone().sub(axis.clone().multiplyScalar(def.grip * L));
    item.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis, top, sideV));
    item.position.copy(back);
    group.add(item);
    info.push({ ...p, def, label: def.label, category: def.category, mode, axis, back, muzzle: back.clone().add(axis.clone().multiplyScalar(L)) });
  }
  return { group, info };
}

/** Hand frame of the mannequin (positions and rotations in world space) for buildProps. */
export function dollHand(doll, side) {
  const wp = (n) => doll.points[n].getWorldPosition(new THREE.Vector3());
  const pos = wp(`${side}Hand`);
  const elbow = wp(`${side}ElbowPt`);
  return {
    pos,
    wrist: doll.joints[`${side}Wrist`].getWorldPosition(new THREE.Vector3()),
    elbow,
    along: pos.clone().sub(elbow).normalize(),
    quat: doll.joints[`${side}Wrist`].getWorldQuaternion(new THREE.Quaternion()),
    foreQuat: doll.joints[`${side}Elbow`].getWorldQuaternion(new THREE.Quaternion()),
  };
}
