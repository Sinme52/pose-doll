// Turns a posed doll + camera into plain English that an image model can follow.
// Image models are unreliable with "the character's left/right", so every limb is named
// by where it appears in the picture first (picture-left / picture-right, or near / far),
// with the character's own side and the reference colour as a cross-check.
import * as THREE from 'three';
import { worldPoint } from './doll.js';

const v3 = () => new THREE.Vector3();

function screen(camera, p) {
  const q = p.clone().project(camera); // NDC: x right, y up
  return { x: q.x, y: q.y, depth: camera.position.distanceTo(p) };
}

function facingPhrase(camera, fwd) {
  const right = v3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  const toViewer = v3().setFromMatrixColumn(camera.matrixWorld, 2).setY(0).normalize(); // camera +Z points back at the viewer
  const f = fwd.clone().setY(0).normalize();
  const x = f.dot(right);
  const z = f.dot(toViewer);
  const ang = (Math.atan2(x, z) * 180) / Math.PI; // 0 = straight at the viewer, +90 = picture-right
  const a = Math.abs(ang);
  const lr = ang < 0 ? 'left' : 'right';
  if (a < 20) return 'faces the viewer (front view)';
  if (a > 160) return 'faces away from the viewer (back view, we see its back)';
  if (a < 70) return `faces toward the LOWER-${lr.toUpperCase()} of the picture (three-quarter front view, turned toward picture-${lr})`;
  if (a <= 110) return `faces picture-${lr} (side / profile view)`;
  return `faces toward the UPPER-${lr.toUpperCase()} of the picture (three-quarter back view, walking away toward picture-${lr})`;
}

/**
 * Returns { text, lines, facts }.
 *  - text: paragraph for the image prompt
 *  - facts: structured numbers, handy for checks and tests
 */
export function describePose(doll, camera, extras = {}) {
  const P = (n) => worldPoint(doll, n);
  const pose = doll.pose;
  const J = pose.joints;
  const props = extras.props || [];
  const colored = doll.style === 'color';
  const color = { left: 'blue', right: 'red' };
  const lines = [];
  const facts = {};

  const chestFwd = P('chestFront').sub(P('chestCenter')).normalize();
  const faceFwd = P('face').sub(P('headCenter')).normalize();
  // body forward from the pelvis: use the chest unless the spine is strongly twisted
  const ls = P('leftHipPt');
  const rs = P('rightHipPt');
  const hipFwd = v3().crossVectors(v3().subVectors(ls, rs), new THREE.Vector3(0, 1, 0)).normalize();
  facts.facing = facingPhrase(camera, hipFwd);
  lines.push(`The figure ${facts.facing}.`);
  const headFacing = facingPhrase(camera, faceFwd);
  if (headFacing !== facts.facing) lines.push(`Its head is turned so that the face ${headFacing.replace(/^faces /, 'looks ')}.`);
  if (facingPhrase(camera, chestFwd) !== facts.facing) lines.push(`The upper body is twisted: the chest ${facingPhrase(camera, chestFwd)}.`);

  // torso
  const lean = [];
  const bend = J.spine.bend + J.chest.bend + J.root.pitch;
  if (bend > 15) lean.push(bend > 50 ? 'bends far forward' : 'leans forward');
  if (bend < -10) lean.push('leans back');
  const sideLean = J.spine.side + J.chest.side + J.root.roll;
  if (Math.abs(sideLean) > 10) lean.push(`leans toward its own ${sideLean > 0 ? 'left' : 'right'}`);
  if (lean.length) lines.push(`The upper body ${lean.join(' and ')}.`);
  if (J.head.nod > 15) lines.push('The head is lowered, looking down.');
  if (J.head.nod < -15) lines.push('The head is tilted back, looking up.');
  if (Math.abs(J.head.tilt) > 12) lines.push(`The head tilts toward its own ${J.head.tilt > 0 ? 'left' : 'right'} shoulder.`);

  const ground = Math.min(P('leftHeel').y, P('leftToe').y, P('rightHeel').y, P('rightToe').y);
  if (J.root.lift > 0.15) lines.push('Both feet are off the ground: the figure is in mid-air.');

  // naming of the two sides as they appear in the picture
  const nameSides = (a, b) => {
    const sa = screen(camera, P(a.replace('side', 'left')));
    const sb = screen(camera, P(b.replace('side', 'right')));
    if (Math.abs(sa.x - sb.x) > 0.06) {
      return sa.x < sb.x ? { left: 'picture-LEFT', right: 'picture-RIGHT' } : { left: 'picture-RIGHT', right: 'picture-LEFT' };
    }
    return sa.depth < sb.depth ? { left: 'NEAR (closer to the viewer)', right: 'FAR (farther from the viewer)' } : { left: 'FAR (farther from the viewer)', right: 'NEAR (closer to the viewer)' };
  };

  const headTop = P('headTop').y;
  const headC = P('headCenter').y;
  const chestY = P('chestCenter').y;
  const pelvisY = P('pelvis').y;
  const H = headTop - ground;

  // arms
  const armNames = nameSides('sideShoulderPt', 'sideShoulderPt');
  facts.arms = {};
  for (const side of ['left', 'right']) {
    const sh = P(`${side}ShoulderPt`);
    const hand = P(`${side}Hand`);
    const elbowBend = J[`${side}Elbow`].bend;
    const y = hand.y;
    let height;
    if (y > headTop + 0.05 * H) height = 'raised high above the head';
    else if (y > headC) height = 'raised to head height';
    else if (y > sh.y - 0.04 * H) height = 'at shoulder height';
    else if (y > chestY - 0.05 * H) height = 'at chest height';
    else if (y > pelvisY - 0.02 * H) height = 'at waist height';
    else height = 'low, down by the thigh';
    const rel = hand.clone().sub(sh).setY(0);
    const fwd = rel.dot(hipFwd.clone().setY(0).normalize());
    const sideAxis = v3().crossVectors(new THREE.Vector3(0, 1, 0), hipFwd).normalize(); // own left
    const out = rel.dot(sideAxis) * (side === 'left' ? 1 : -1);
    const dir = [];
    const reach = rel.length() / H;
    if (reach > 0.12) {
      if (fwd > 0.1 * H) dir.push('reaching forward');
      if (fwd < -0.1 * H) dir.push('pulled back behind the body');
      if (out > 0.12 * H) dir.push('out to the side');
      if (out < -0.05 * H) dir.push('across the front of the body');
    }
    const elbow = elbowBend < 25 ? 'arm almost straight' : elbowBend > 110 ? 'elbow sharply bent' : 'elbow bent';
    const w = J[`${side}Wrist`];
    const held = props.find((p) => p.hands.includes(side));
    let handShape;
    if (held && held.category === 'shield') handShape = `forearm strapped into the ${held.label}, hand gripping its handle`;
    else if (held && held.category === 'blade') handShape = held.hands[0] === side ? `hand closed around the ${held.label}'s hilt` : `hand also on the ${held.label}'s hilt, below the other hand`;
    else if (held) handShape = held.hands[0] === side ? `hand closed around the ${held.label}'s grip` : `hand supporting the ${held.label} further along`;
    else if (w.point >= 0.5) handShape = 'index finger pointing';
    else if (w.grip >= 60) handShape = 'hand closed around a held object';
    else if (w.grip < 25) handShape = 'hand open, fingers straight';
    else handShape = 'fingers loosely curled';
    const own = `the character's own ${side.toUpperCase()} arm${colored ? `, ${color[side]} in the pose reference` : ''}`;
    const parts = [height, ...dir, elbow, handShape].filter(Boolean);
    lines.push(`The ${armNames[side]} arm (${own}): hand ${parts.join(', ')}.`);
    facts.arms[side] = { picture: armNames[side], handHeight: (y - ground) / H, forward: fwd / H, out: out / H, elbowBend, held: held ? held.label : null };
  }
  // how the two hands relate (which one is in front / higher)
  {
    const A = facts.arms.left;
    const B = facts.arms.right;
    const rel = [];
    if (Math.abs(A.forward - B.forward) > 0.05) {
      const [f, b] = A.forward > B.forward ? ['left', 'right'] : ['right', 'left'];
      rel.push(`the ${armNames[f]} hand is further forward (out in front of the body) than the ${armNames[b]} hand`);
    }
    if (Math.abs(A.handHeight - B.handHeight) > 0.04) {
      const [hi, lo] = A.handHeight > B.handHeight ? ['left', 'right'] : ['right', 'left'];
      rel.push(`the ${armNames[hi]} hand is higher than the ${armNames[lo]} hand`);
    }
    if (rel.length) lines.push(`Hands: ${rel.join('; ')}.`);
    facts.hands = { forwardDiff: A.forward - B.forward, heightDiff: A.handHeight - B.handHeight };
  }
  // held items
  facts.props = [];
  const toViewer = v3().setFromMatrixColumn(camera.matrixWorld, 2).setY(0).normalize();
  const camAbove = camera.position.y > chestY + 0.2 * H;
  const own = (side) => `the ${armNames[side]} hand (the character's own ${side.toUpperCase()} hand)`;
  const heightOf = (y, side) => (y < pelvisY + 0.06 * H ? 'low, at hip height' : y < chestY ? 'at waist height'
    : y < P(`${side}ShoulderPt`).y - 0.04 * H ? 'at chest height' : y < headTop ? 'up at shoulder height' : 'raised above the head');
  const screenDir = (from, to, vec) => {
    const dx = screen(camera, to).x - screen(camera, from).x;
    const depth = vec.clone().setY(0).dot(toViewer);
    const out = [];
    if (Math.abs(dx) > 0.04) out.push(`toward picture-${dx < 0 ? 'left' : 'right'}`);
    if (Math.abs(depth) > 0.35) out.push(depth > 0 ? 'toward the viewer' : 'away from the viewer');
    return { out, dx, depth };
  };
  for (const p of props) {
    const def = p.def || {};
    const label = p.label;
    const stand = `In the pose reference it is a grey stand-in with an orange marker on the ${def.tip}; draw the character's own ${label} from IMAGE 1 (its real design, size and colors) in this position.`;
    if (p.category === 'shield') {
      const { out, dx, depth } = screenDir(p.center, p.center.clone().add(p.normal), p.normal);
      const facing = out.length ? out.join(' and ') : (p.normal.y > 0.5 ? 'upward' : p.normal.y < -0.5 ? 'downward' : 'sideways');
      const at = heightOf(p.center.y, p.hands[0]);
      const tilt = Math.round((Math.asin(Math.max(-1, Math.min(1, p.normal.y))) * 180) / Math.PI);
      lines.push(`Held item: a ${label} strapped to the ${armNames[p.hands[0]]} forearm (the character's own ${p.hands[0].toUpperCase()} arm), held ${at}; its front face (orange boss) faces ${facing}${Math.abs(tilt) > 20 ? `, tilted ${tilt > 0 ? 'up' : 'down'} by ${Math.abs(tilt)} degrees` : ''}. ${stand}`);
      facts.props.push({ type: p.type, category: p.category, hands: p.hands, facing, screenDx: dx, depth, heldAt: at });
      continue;
    }
    const { out: dirs, dx, depth } = screenDir(p.back, p.muzzle, p.axis);
    const pitch = (Math.asin(Math.max(-1, Math.min(1, p.axis.y))) * 180) / Math.PI;
    dirs.push(pitch < -50 ? 'steeply downward' : pitch < -25 ? 'downward' : pitch < -7 ? 'slightly down' : pitch > 50 ? 'steeply upward' : pitch > 25 ? 'upward' : pitch > 7 ? 'slightly up' : 'level');
    let grip;
    if (p.hands.length === 2 && p.category === 'blade') {
      grip = `gripped with both hands on the hilt: ${own(p.hands[0])} just below the guard and ${own(p.hands[1])} below it, near the pommel`;
    } else if (p.hands.length === 2) {
      grip = `held in both hands: ${own(p.hands[0])} on the grip and ${own(p.hands[1])} supporting it further forward`;
    } else if (p.category === 'blade') {
      grip = `held by the hilt in one hand, ${own(p.hands[0])}${p.mode === 'thumb' && p.angle && Math.abs(p.angle) > 120 ? ', in a reverse grip (blade coming out of the little-finger side of the fist)' : ''}`;
    } else {
      grip = `held in one hand, ${own(p.hands[0])}`;
    }
    const at = heightOf(P(`${p.hands[0]}Hand`).y, p.hands[0]);
    let persp = '';
    const chestDist = camera.position.distanceTo(P('chestCenter'));
    const handDist = Math.min(...p.hands.map((h) => camera.position.distanceTo(P(`${h}Hand`))));
    if (camAbove && handDist > chestDist + 0.04 * H && /hip|waist|chest/.test(at)) {
      persp = ` From this high camera the ${label} is on the far side of the body, so it appears higher in the picture than its real height: it is NOT raised, it stays ${at.replace(/^low, /, '')}, partly hidden behind the body.`;
    } else if (camAbove && depth < -0.35 && pitch < 15) {
      persp = ` Because it points away from the viewer and the camera looks down from above, its ${def.tip} appears higher in the picture than the hands: it is NOT raised.`;
    }
    lines.push(`Held item: a ${label} ${grip}, held ${at}; the ${def.tip} points ${dirs.join(', ')} (${Math.round(pitch)} degrees from level).${persp} ${stand}`);
    facts.props.push({ type: p.type, category: p.category, hands: p.hands, pitch, screenDx: dx, depth, heldAt: at });
  }

  // legs
  const legNames = nameSides('sideHipPt', 'sideHipPt');
  facts.legs = {};
  const footInfo = {};
  for (const side of ['left', 'right']) {
    const heel = P(`${side}Heel`);
    const toe = P(`${side}Toe`);
    const knee = P(`${side}KneePt`);
    const hip = P(`${side}HipPt`);
    const low = Math.min(heel.y, toe.y);
    const onGround = low - ground < 0.03 * H && J.root.lift <= 0.15;
    const heelUp = heel.y - toe.y > 0.03 * H;
    const footLen = heel.distanceTo(toe);
    const tilt = (Math.atan2(heel.y - toe.y, Math.max(1e-6, Math.hypot(heel.x - toe.x, heel.z - toe.z))) * 180) / Math.PI; // + heel above toes
    const footMid = heel.clone().add(toe).multiplyScalar(0.5);
    const fwd = footMid.clone().sub(P('pelvis')).setY(0).dot(hipFwd.clone().setY(0).normalize()) / H;
    const fs = screen(camera, footMid);
    // does the sole face the camera? (the sole is the foot's -Y side)
    const sole = new THREE.Vector3(0, -1, 0).applyQuaternion(doll.joints[`${side}Ankle`].getWorldQuaternion(new THREE.Quaternion()));
    const soleVis = sole.dot(camera.position.clone().sub(footMid).normalize());
    footInfo[side] = { fwd, onGround, heelUp, sx: fs.x, sy: fs.y, soleVis, hipSx: screen(camera, hip).x, depth: fs.depth };
    const desc = [];
    if (knee.y > hip.y - 0.05 * H) desc.push('knee lifted up to hip height');
    else if (knee.y > hip.y - 0.17 * H) desc.push('knee raised');
    void footLen;
    let contact;
    if (!onGround) contact = 'foot off the ground';
    else if (tilt < -8) contact = 'heel strike: heel touching down with the toes raised';
    else if (tilt <= 8) contact = 'foot planted flat on the ground';
    else if (tilt <= 25) contact = 'heel slightly lifted, ball of the foot on the ground';
    else if (tilt <= 50) contact = 'heel lifted, weight on the toes';
    else contact = 'heel raised high, only the toe tips touching';
    desc.push(contact);
    if (fwd > 0.07) desc.push('stepping forward');
    else if (fwd < -0.07) desc.push('trailing behind');
    const kb = J[`${side}Knee`].bend;
    desc.push(kb < 20 ? 'leg straight' : kb > 100 ? 'knee deeply bent' : 'knee bent');
    const own = `the character's own ${side.toUpperCase()} leg${colored ? `, ${color[side]} in the pose reference` : ''}`;
    lines.push(`The ${legNames[side]} leg (${own}): ${desc.join(', ')}.`);
    facts.legs[side] = { picture: legNames[side], forward: fwd, onGround, heelUp, kneeBend: kb, footTilt: tilt, contact };
  }
  // where the feet really are in the picture (the leg names above follow the hips)
  facts.warnings = facts.warnings || [];
  const ownFoot = (side) => `own ${side.toUpperCase()}${colored ? ` (${color[side]})` : ''}`;
  const rel = (a, b) => {
    const dx = footInfo[a].sx - footInfo[b].sx;
    const dy = footInfo[a].sy - footInfo[b].sy; // NDC: + is up
    const v = Math.abs(dy) > 0.02 ? (dy > 0 ? 'UPPER' : 'LOWER') : '';
    const h = Math.abs(dx) > 0.02 ? (dx < 0 ? 'LEFT' : 'RIGHT') : '';
    return [v, h].filter(Boolean).join('-') || 'SAME PLACE';
  };
  const fdx = footInfo.left.sx - footInfo.right.sx;
  const fdy = footInfo.left.sy - footInfo.right.sy;
  const hipOrder = Math.sign(footInfo.left.hipSx - footInfo.right.hipSx);
  facts.legsCross = Math.abs(fdx) > 0.02 && Math.sign(fdx) !== hipOrder && Math.abs(footInfo.left.hipSx - footInfo.right.hipSx) > 0.01;
  facts.feetOverlap = Math.abs(fdx) < 0.03 && Math.abs(fdy) < 0.06;
  facts.feetDx = fdx;
  let df = footInfo.left.fwd - footInfo.right.fwd;
  // a picture-mirrored stride opens the legs sideways in 3D: it says itself which foot is in front
  if (Math.abs(df) <= 0.08 && pose.stride && pose.stride.front) df = pose.stride.front === 'left' ? 1 : -1;
  if (Math.abs(df) > 0.08) {
    const front = df > 0 ? 'left' : 'right';
    const back = df > 0 ? 'right' : 'left';
    facts.front = front;
    facts.frontFootPosition = rel(front, back);
    let t = `Stride check: the FORWARD foot is the character's ${ownFoot(front)} foot; in the picture it is at the ${rel(front, back)} of the pair of feet, and the back foot (${ownFoot(back)}) is at the ${rel(back, front)}.`;
    const isBack = hipFwd.clone().setY(0).normalize().dot(v3().setFromMatrixColumn(camera.matrixWorld, 2).setY(0).normalize()) < -0.3;
    if (facts.legsCross) {
      t += ` The legs CROSS in the picture: the forward foot ends up on the opposite side from its own hip. Keep this crossing; do not swap the feet back to their own sides.`;
      if (isBack) {
        // seen from behind, the back leg is the one nearer the camera and hides the forward leg
        const nearer = footInfo[back].depth < footInfo[front].depth ? back : front;
        const hidden = nearer === back ? front : back;
        facts.hiddenLeg = hidden;
        t += ` Seen from behind, the back leg (${ownFoot(back)}) is the nearer one and passes in front of the forward leg: it HIDES MOST of the forward leg (${ownFoot(hidden)}), of which only the boot peeks out, at the ${rel(front, back)} beyond the back leg's knee and calf. Draw only one fully visible leg (the ${back.toUpperCase()} one) plus that partly hidden ${front.toUpperCase()} boot; do not draw the two legs side by side.`;
      }
    }
    // image models get crossed legs right in front views, but redraw them uncrossed (= the other stride) in back views
    if (facts.legsCross && isBack) facts.warnings.push(`legs cross in the picture in a back view (the forward ${front} foot appears on the other side of its hip, mostly hidden behind the back leg); image models may uncross them and draw the other stride: check the result (CHECK lines), or use --uncross / ~picture`);
    if (facts.feetOverlap && isBack) facts.warnings.push('the feet overlap in the picture in a back view, so one leg hides the other: use --uncross');
    lines.push(t);
  }
  // which boot shows its sole: the strongest cue for front / back legs in back views
  const backView = hipFwd.clone().setY(0).normalize().dot(v3().setFromMatrixColumn(camera.matrixWorld, 2).setY(0).normalize()) < -0.3;
  facts.backView = backView;
  const soles = ['left', 'right'].filter((s) => footInfo[s].soleVis > 0.1);
  facts.solesVisible = soles;
  const desc = (s) => `the character's ${ownFoot(s)} one${facts.front ? (s === facts.front ? ' (the forward foot)' : ' (the back foot, heel lifted)') : ''}, at the ${rel(s, s === 'left' ? 'right' : 'left')} of the two feet`;
  if (soles.length === 1) {
    lines.push(`Only one boot shows its sole to the viewer: ${desc(soles[0])}. The other boot's sole is hidden${backView ? ' (we see its heel and top)' : ''}.`);
  } else if (soles.length === 2) {
    lines.push('Both boots show their soles to the viewer.');
  } else if (backView) {
    lines.push('No boot sole faces the viewer: both feet are seen from the heel and top.');
  }
  if (pose.intent) lines.unshift(`Pose: ${pose.intent}.`);
  return { text: lines.join(' '), lines, facts };
}
