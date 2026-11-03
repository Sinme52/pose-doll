// Drive a rigged character model (e.g. a Meshy auto-rig GLB, Mixamo-style bone names) with the
// same pose JSON as the mannequin. The mannequin is posed first; every model bone is then turned
// so that its rest frame (bone direction + forward) matches the corresponding mannequin segment.
// Only rotations are transferred, so the model keeps its own proportions.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { standingHeight } from './doll.js';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const NY = new THREE.Vector3(0, -1, 0);

// model bone -> [doll joint, doll-local primary axis, doll-local secondary axis]
// aliases cover Mixamo ("mixamorig:LeftArm") and Meshy ("LeftArm", "Spine01") names.
const MAP = [
  ['Hips', 'root', Y, Z],
  ['Spine', 'spine', Y, Z],
  ['Spine01|Spine1', 'chest', Y, Z],
  ['Spine02|Spine2', 'chest', Y, Z],
  ['neck|Neck', 'neck', Y, Z],
  ['Head', 'head', Y, Z],
  ['LeftShoulder', 'chest', Y, Z, 'keep'],
  ['RightShoulder', 'chest', Y, Z, 'keep'],
  ['LeftArm', 'leftShoulder', NY, Z],
  ['LeftForeArm', 'leftElbow', NY, Z],
  ['LeftHand', 'leftWrist', NY, Z],
  ['RightArm', 'rightShoulder', NY, Z],
  ['RightForeArm', 'rightElbow', NY, Z],
  ['RightHand', 'rightWrist', NY, Z],
  ['LeftUpLeg', 'leftHip', NY, Z],
  ['LeftLeg', 'leftKnee', NY, Z],
  ['LeftFoot', 'leftAnkle', Z, Y],
  ['RightUpLeg', 'rightHip', NY, Z],
  ['RightLeg', 'rightKnee', NY, Z],
  ['RightFoot', 'rightAnkle', Z, Y],
];

function findBone(root, names) {
  const want = names.split('|').map((n) => n.toLowerCase());
  let hit = null;
  root.traverse((o) => {
    if (hit || !o.isBone) return;
    const n = o.name.toLowerCase().replace(/^mixamorig[:_]?/, '');
    if (want.includes(n)) hit = o;
  });
  return hit;
}

// orthonormal basis (as a quaternion) from a primary and a secondary direction
function frame(primary, secondary) {
  const p = primary.clone().normalize();
  const s = secondary.clone().sub(p.clone().multiplyScalar(secondary.dot(p)));
  if (s.lengthSq() < 1e-8) s.copy(Math.abs(p.y) < 0.9 ? Y : Z).sub(p.clone().multiplyScalar(p.dot(Math.abs(p.y) < 0.9 ? Y : Z)));
  s.normalize();
  const t = new THREE.Vector3().crossVectors(p, s);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(p, s, t));
}

const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

export async function loadModel(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  const holder = new THREE.Group();
  holder.add(scene);
  scene.updateMatrixWorld(true);
  const bones = [];
  for (const [names, joint, pAxis, sAxis, mode] of MAP) {
    const bone = findBone(scene, names);
    if (!bone) continue;
    bones.push({ bone, joint, pAxis, sAxis, mode });
  }
  if (!bones.find((b) => b.joint === 'root')) throw new Error('rigged model has no Hips bone');
  // rest pose (bind pose as loaded; animations are not played)
  for (const b of bones) {
    b.restLocal = b.bone.quaternion.clone();
    b.restWorld = wquat(b.bone);
    const child = b.bone.children.find((c) => c.isBone);
    const here = wpos(b.bone);
    let dir;
    if (b.pAxis === Z) {
      dir = child ? wpos(child).sub(here).setY(0) : Z.clone(); // foot: horizontal toward the toes
      if (dir.lengthSq() < 1e-6) dir = Z.clone();
    } else if (child && wpos(child).distanceTo(here) > 1e-4) {
      dir = wpos(child).sub(here);
    } else {
      const parent = bones.find((o) => o.bone === b.bone.parent);
      dir = parent ? parent.restDir.clone() : Y.clone();
    }
    b.restDir = dir.normalize();
    // the model's rest frame, expressed like the doll's frame (primary, secondary)
    const sec = b.sAxis === Z ? Z : Y;
    b.restFrame = frame(b.restDir, sec);
  }
  const box = new THREE.Box3().setFromObject(scene);
  const hips = bones.find((b) => b.joint === 'root').bone;
  const model = {
    holder, scene, bones, hips,
    hipsRestPos: hips.position.clone(),
    restBox: box,
    meshes: [],
  };
  scene.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      model.meshes.push(o);
    }
  });
  return model;
}

/** Pose the model like the (already posed) doll, scale it to the doll's height and stand it on y = lift. */
export function poseModel(model, doll) {
  const { bones } = model;
  // doll frames
  const dollQ = {};
  const jointObj = (name) => (name === 'neck' ? null : doll.joints[name]);
  for (const b of bones) {
    if (b.mode === 'keep') continue;
    let q;
    if (b.joint === 'neck') {
      q = wquat(doll.joints.chest).slerp(wquat(doll.joints.head), 0.5);
    } else {
      q = wquat(jointObj(b.joint));
    }
    // undo the doll's own placement so only its pose counts
    dollQ[b.bone.uuid] = q.premultiply(wquat(doll.root).invert());
  }
  // reset, then walk the hierarchy (bones are listed parents first)
  for (const b of bones) b.bone.quaternion.copy(b.restLocal);
  model.hips.position.copy(model.hipsRestPos);
  model.holder.position.set(0, 0, 0);
  model.holder.scale.setScalar(1);
  model.scene.updateMatrixWorld(true);
  for (const b of bones) {
    const parent = b.bone.parent;
    parent.updateMatrixWorld(true);
    let worldTarget;
    if (b.mode === 'keep') {
      // keep the rest offset relative to its parent (clavicles follow the chest)
      worldTarget = wquat(parent).multiply(b.restLocal);
    } else {
      const q = dollQ[b.bone.uuid];
      const target = frame(b.pAxis.clone().applyQuaternion(q), b.sAxis.clone().applyQuaternion(q));
      const delta = target.multiply(b.restFrame.clone().invert());
      worldTarget = delta.multiply(b.restWorld);
    }
    const local = wquat(parent).invert().multiply(worldTarget);
    b.bone.quaternion.copy(local);
    b.bone.updateMatrixWorld(true);
  }
  // scale to the doll's standing height, then ground
  const H = standingHeight(doll);
  const restH = model.restBox.max.y - model.restBox.min.y;
  model.holder.scale.setScalar(H / restH);
  model.holder.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of model.meshes) {
    if (m.isSkinnedMesh) {
      m.skeleton.update();
      const pos = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        m.applyBoneTransform(i, v);
        box.expandByPoint(v.applyMatrix4(m.matrixWorld));
      }
    } else box.expandByObject(m);
  }
  model.holder.position.set(0, -box.min.y + doll.pose.joints.root.lift, 0);
  // keep the hips over the doll's pelvis horizontally
  const hipsW = wpos(model.hips);
  const pelvis = doll.points.pelvis.getWorldPosition(new THREE.Vector3());
  model.holder.position.x += pelvis.x - hipsW.x;
  model.holder.position.z += pelvis.z - hipsW.z;
  model.holder.updateMatrixWorld(true);
  return model;
}
