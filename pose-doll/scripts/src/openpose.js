// OpenPose (COCO 18 keypoints) from the posed mannequin, for ControlNet and other tools.
// Order: 0 nose, 1 neck, 2 R shoulder, 3 R elbow, 4 R wrist, 5 L shoulder, 6 L elbow, 7 L wrist,
// 8 R hip, 9 R knee, 10 R ankle, 11 L hip, 12 L knee, 13 L ankle, 14 R eye, 15 L eye, 16 R ear, 17 L ear.
// "R"/"L" are the character's own right/left, as in OpenPose. Face points that point away from the
// camera (back views) are left out, the way OpenPose itself does not find them.
import * as THREE from 'three';
import { worldPoint } from './doll.js';

export const COCO_NAMES = ['nose', 'neck', 'r_shoulder', 'r_elbow', 'r_wrist', 'l_shoulder', 'l_elbow', 'l_wrist',
  'r_hip', 'r_knee', 'r_ankle', 'l_hip', 'l_knee', 'l_ankle', 'r_eye', 'l_eye', 'r_ear', 'l_ear'];
// limb pairs (0-based) and colours used by the OpenPose / ControlNet body renderer
export const LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13],
  [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
export const COLORS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0],
  [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255],
  [255, 0, 255], [255, 0, 85], [255, 0, 0]];

/**
 * 18 keypoints in pixels: [[x, y, confidence], ...] (confidence 0 = not visible).
 * width/height: image size. The doll must be posed and the camera framed.
 */
export function openposeKeypoints(doll, camera, width, height) {
  const P = (n) => worldPoint(doll, n);
  const hq = doll.joints.head.getWorldQuaternion(new THREE.Quaternion());
  const head = P('headCenter');
  const local = (x, y, z) => head.clone().add(new THREE.Vector3(x, y, z).applyQuaternion(hq));
  const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);
  const world = [
    P('face'), mid(P('leftShoulderPt'), P('rightShoulderPt')),
    P('rightShoulderPt'), P('rightElbowPt'), P('rightWristPt'), P('leftShoulderPt'), P('leftElbowPt'), P('leftWristPt'),
    P('rightHipPt'), P('rightKneePt'), P('rightAnklePt'), P('leftHipPt'), P('leftKneePt'), P('leftAnklePt'),
    local(-0.17, 0.1, 0.4), local(0.17, 0.1, 0.4), local(-0.4, 0.02, 0.02), local(0.4, 0.02, 0.02),
  ];
  // face points are only seen when the face (or that side of the head) turns toward the camera
  const facing = P('face').sub(head).normalize();
  const toCam = camera.position.clone().sub(head).normalize();
  const faceVis = facing.dot(toCam);
  const sideAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(hq); // own left
  const vis = world.map((_, i) => {
    if (i === 0 || i === 14 || i === 15) return faceVis > 0.05;
    if (i === 16) return sideAxis.clone().negate().dot(toCam) > -0.2 || faceVis > 0.3; // right ear
    if (i === 17) return sideAxis.dot(toCam) > -0.2 || faceVis > 0.3; // left ear
    return true;
  });
  return world.map((p, i) => {
    const q = p.clone().project(camera);
    return [Math.round(((q.x + 1) / 2) * width * 10) / 10, Math.round(((1 - q.y) / 2) * height * 10) / 10, vis[i] ? 1 : 0];
  });
}

/** OpenPose JSON as written by the OpenPose tool (and read by ControlNet / ComfyUI pose editors). */
export function openposeJson(kps, width, height) {
  return {
    version: 1.3,
    canvas_width: width,
    canvas_height: height,
    people: [{ pose_keypoints_2d: kps.flatMap(([x, y, c]) => (c ? [x, y, c] : [0, 0, 0])) }],
    keypoint_names: COCO_NAMES,
  };
}

/** Draw the keypoints the way the ControlNet OpenPose preprocessor does (black background). */
export function drawOpenpose(ctx, kps, width, height) {
  const stick = Math.max(2, Math.round(Math.min(width, height) / 128));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  LIMBS.forEach(([a, b], i) => {
    const [x1, y1, c1] = kps[a];
    const [x2, y2, c2] = kps[b];
    if (!c1 || !c2) return;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = `rgb(${COLORS[i].join(',')})`;
    ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(0, 0, len / 2, stick, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  kps.forEach(([x, y, c], i) => {
    if (!c) return;
    ctx.fillStyle = `rgb(${COLORS[i].join(',')})`;
    ctx.beginPath();
    ctx.arc(x, y, stick, 0, Math.PI * 2);
    ctx.fill();
  });
}
