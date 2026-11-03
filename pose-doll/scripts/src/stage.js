// Browser-side scene: renderer, lights, doll and camera. Used by the editor and the headless renderer.
import * as THREE from 'three';
import { createDoll, applyPose, frameCamera, normalizePose } from './doll.js';
import { describePose } from './describe.js';
import { loadModel, poseModel } from './model.js';
import { buildProps, dollHand } from './props.js';
import { uncrossLegs } from './uncross.js';
import { openposeKeypoints, openposeJson, drawOpenpose } from './openpose.js';

// spread the figure's depth values over 40..255 (near = white), background stays black
function stretchDepth(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 2) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] <= 2) continue;
    const v = Math.round(40 + ((d[i] - lo) / span) * 215);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export class Stage {
  constructor(canvas, { size = 1024, background = '#ffffff', preserve = false } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: preserve });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 8, 6); // upper left, like the game sprites
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(5, 2, -3);
    this.scene.add(fill);
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.ground.position.y = 0.001;
    this.scene.add(this.ground);
    this.style = 'color';
    this.doll = null;
    this.model = null;
    this.modelUrl = null;
    this.buildKey = '';
    this.setSize(size, size);
    this.setBackground(background);
  }

  setSize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setBackground(bg) {
    if (!bg || bg === 'transparent') {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.scene.background = new THREE.Color(bg);
    }
  }

  /** Use a rigged character model (GLB URL) instead of the mannequin; null switches back. */
  async setModel(url) {
    if (url === this.modelUrl) return this.model;
    if (this.model) this.scene.remove(this.model.holder);
    this.model = url ? await loadModel(url) : null;
    this.modelUrl = url || null;
    if (this.model) this.scene.add(this.model.holder);
    if (this.pose) this.setPose(this.pose);
    return this.model;
  }

  /** Pose the doll (and the model, when one is loaded). options: { style, ground } */
  setPose(rawPose, { style = this.style, ground = false } = {}) {
    const pose = normalizePose(rawPose);
    const key = JSON.stringify(pose.build) + style;
    if (key !== this.buildKey) {
      if (this.doll) this.scene.remove(this.doll.root);
      this.doll = createDoll(pose.build, style);
      this.scene.add(this.doll.root);
      this.buildKey = key;
      this.style = style;
    }
    applyPose(this.doll, pose);
    for (const m of this.doll.meshes) m.visible = !this.model;
    if (this.model) poseModel(this.model, this.doll);
    if (this.propGroup) this.scene.remove(this.propGroup);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.doll.joints.chest.getWorldQuaternion(new THREE.Quaternion()));
    const built = buildProps(pose.props, (side) => this.handFrame(side), up);
    this.propGroup = built.group;
    this.propInfo = built.info;
    this.scene.add(this.propGroup);
    this.ground.visible = ground;
    this.ground.scale.setScalar(this.doll.d.k * 0.8 + 0.4);
    this.cameraSpec = frameCamera(this.camera, this.doll, pose.camera, [this.propGroup]);
    this.pose = pose;
    return pose;
  }

  /** Hand frame for props: mannequin rotations, positions from the model when one is loaded. */
  handFrame(side) {
    const f = dollHand(this.doll, side);
    if (this.model) {
      const hand = this.model.bones.find((b) => b.joint === `${side}Wrist`);
      const fore = this.model.bones.find((b) => b.joint === `${side}Elbow`);
      if (hand && fore) {
        const w = hand.bone.getWorldPosition(new THREE.Vector3());
        const e = fore.bone.getWorldPosition(new THREE.Vector3());
        const along = w.clone().sub(e).normalize();
        return { ...f, wrist: w, elbow: e, along, pos: w.clone().add(along.clone().multiplyScalar(0.3 * this.doll.d.k)) };
      }
    }
    return f;
  }

  /** Back views only: open the hips where the legs would cross / hide each other (see uncross.js). */
  uncrossLegs(rawPose) {
    return uncrossLegs(rawPose);
  }

  /**
   * Extra pictures for other image generators (call after setPose). layers: 'depth', 'mask', 'openpose'.
   * Returns { depth?: dataURL, mask?: dataURL, openpose?: dataURL, keypoints?: OpenPose JSON }.
   */
  renderLayers(layers = []) {
    const out = {};
    const canvas = this.renderer.domElement;
    const w = canvas.width;
    const h = canvas.height;
    const keep = { bg: this.scene.background, ground: this.ground.visible, near: this.camera.near, far: this.camera.far, clear: this.renderer.getClearAlpha() };
    this.ground.visible = false;
    this.scene.background = new THREE.Color(0x000000);
    if (layers.includes('depth')) {
      // near = white, far = black (MiDaS / ControlNet depth convention), range fitted to the figure
      const box = new THREE.Box3().setFromObject(this.model ? this.model.holder : this.doll.root);
      if (this.propGroup) box.union(new THREE.Box3().setFromObject(this.propGroup));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const d = this.camera.position.distanceTo(sphere.center);
      this.camera.near = Math.max(0.01, d - sphere.radius * 1.05);
      this.camera.far = d + sphere.radius * 1.05;
      this.camera.updateProjectionMatrix();
      this.scene.overrideMaterial = new THREE.MeshDepthMaterial();
      this.renderer.render(this.scene, this.camera);
      out.depth = stretchDepth(canvas, w, h);
      this.camera.near = keep.near;
      this.camera.far = keep.far;
      this.camera.updateProjectionMatrix();
    }
    if (layers.includes('mask')) {
      this.scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.renderer.render(this.scene, this.camera);
      out.mask = canvas.toDataURL('image/png');
    }
    this.scene.overrideMaterial = null;
    this.scene.background = keep.bg;
    this.ground.visible = keep.ground;
    if (layers.includes('openpose')) {
      const kps = openposeKeypoints(this.doll, this.camera, w, h);
      const c2 = document.createElement('canvas');
      c2.width = w;
      c2.height = h;
      drawOpenpose(c2.getContext('2d'), kps, w, h);
      out.openpose = c2.toDataURL('image/png');
      out.keypoints = openposeJson(kps, w, h);
    }
    this.render();
    return out;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  describe() {
    return describePose(this.doll, this.camera, { props: this.propInfo });
  }

  /** Mesh part name under a canvas pixel (for click-to-select in the editor). */
  pick(x, y) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (this.model) return null;
    const hit = ray.intersectObjects(this.doll.meshes, false)[0];
    return hit ? hit.object.userData.part : null;
  }
}
