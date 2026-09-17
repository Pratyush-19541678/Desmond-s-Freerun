import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { initPhysics, addHayBody, stepBody } from './physics.js';
// Exact per-triangle collision: every raycast in the game runs against BVH
// acceleration structures built over the real townscape polygons.
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/* ============================================================
   DESMON RUN — Desmond parkours through Monteriggioni
   - Desmond is the ONLY humanoid character in the scene
   - City: ../scene.gltf (Monteriggioni, CC-BY-4.0 Olaf.Rodowald)
   - Desmond: procedural assassin-runner + optional ./desmond.glb
     (export AC1-Desmond_Miles.blend -> desmond.glb in Blender)
   Run with a local server, e.g.:  python -m http.server 8000
   then open http://localhost:8000/game/
   ============================================================ */

const canvas = document.getElementById('game-canvas');
const loadingEl = document.getElementById('loading');
const loadFill = document.getElementById('load-fill');
const loadText = document.getElementById('load-text');
const menuEl = document.getElementById('menu');
const playBtn = document.getElementById('play-btn');
const hudEl = document.getElementById('hud');
const timerPill = document.getElementById('timer-pill');
const speedPill = document.getElementById('speed-pill');
const staminaFill = document.getElementById('stamina-fill');
const popupEl = document.getElementById('move-popup');
const hintBar = document.getElementById('hint-bar');
const toastEl = document.getElementById('toast');
const touchEl = document.getElementById('touch');

console.log('%cDESMON RUN%c  City: "Monteriggioni" by Olaf.Rodowald (CC-BY-4.0) https://sketchfab.com/3d-models/monteriggioni-5a0bcecb63524854b231feba34c6fbf9',
  'background:#f5c542;color:#000;padding:2px 6px;font-weight:bold', 'color:inherit');

/* ---------------- renderer / scene / camera ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
scene.fog = new THREE.Fog(0x9fc0dd, 60, 340);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5f, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 2.0);
sun.position.set(60, 90, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 300;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

// stylized sky dome
{
  const skyGeo = new THREE.SphereGeometry(800, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d7ac2) }, bottom: { value: new THREE.Color(0xdfeaf5) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bottom;' +
      'void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.35,0.95,h)), 1.0); }'
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

/* ---------------- tiny synth audio (no assets) ---------------- */
let audioCtx = null;
function beep(freq = 440, dur = 0.12, type = 'sine', gain = 0.15) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio optional */ }
}
const sfx = {
  jump: () => beep(300, 0.15, 'square', 0.06),
  vault: () => { beep(500, 0.1, 'triangle', 0.12); setTimeout(() => beep(750, 0.12, 'triangle', 0.12), 70); },
  climb: () => { beep(220, 0.12, 'sawtooth', 0.05); setTimeout(() => beep(330, 0.14, 'sawtooth', 0.05), 90); },
  ring: () => { beep(880, 0.12, 'sine', 0.16); setTimeout(() => beep(1320, 0.2, 'sine', 0.16), 100); },
  land: () => beep(140, 0.1, 'sine', 0.1),
  wallrun: () => beep(660, 0.18, 'triangle', 0.07),
  step: () => beep(70 + Math.random() * 30, 0.06, 'sine', 0.04),
  grab: () => beep(180, 0.1, 'square', 0.07),
  feint: () => { beep(500, 0.08, 'sawtooth', 0.05); setTimeout(() => beep(900, 0.1, 'sawtooth', 0.05), 60); },
  slide: () => beep(220, 0.25, 'sawtooth', 0.05),
  // eagle screech for the leap of faith: two detuned glides downward
  screech: () => {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime;
      for (const [f0, f1, d, g0] of [[2100, 900, 0.7, 0.07], [2600, 1200, 0.55, 0.045]]) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(Math.max(50, f1), t0 + d);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(g0, t0 + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0); o.stop(t0 + d + 0.05);
      }
    } catch (e) { /* audio optional */ }
  },
};

// wind: looped filtered noise, gain follows height + speed (starts on play)
let windGain = null;
function startWind() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (windGain) return;
    const len = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const ch = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      ch[i] = last * 3.2;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420;
    windGain = audioCtx.createGain(); windGain.gain.value = 0.0;
    src.connect(filt); filt.connect(windGain); windGain.connect(audioCtx.destination);
    src.start();
  } catch (e) { /* audio optional */ }
}
function updateWind() {
  if (!windGain || !started) return;
  const target = Math.max(0, Math.min(0.11, 0.015 + P.pos.y * 0.0012 + P.speed2d * 0.006));
  windGain.gain.value += (target - windGain.gain.value) * 0.05;
}

/* ---------------- input ---------------- */
const keys = {};
let jumpQueued = false, vaultQueued = false;
let lastTapA = -9, lastTapD = -9; // double-tap A/D = sprint feint
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyE') {
    // sprinting fast: juke right · airborne: swan dive · else: vault/mantle
    if (P.grounded && P.speed2d > 5) startFeint(1);
    else if (!P.grounded) P.diveFlag = true;
    else vaultQueued = true;
  }
  if (e.code === 'KeyQ') {
    if (P.grounded && P.speed2d > 3) startFeint(-1);
  }
  if (e.code === 'KeyC') {
    // sprinting fast: powerslide (DPS VaultSlide) · else hold-crouch
    if (P.grounded && P.speed2d > 5 && (P.state === 'ground' || P.state === 'air')) startSlide();
    else if ((P.state === 'ground' || P.state === 'air') && P.stance === 'stand') P.stance = 'crouch';
  }
  if (e.code === 'KeyZ') {
    // toggle prone crawl for tunnels (needs room to stand again)
    if (P.stance === 'prone') tryStand();
    else if (P.state === 'ground' || P.state === 'air') P.stance = 'prone';
  }
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
    if (P.elapsed - lastTapA < 0.28) startFeint(-1);
    lastTapA = P.elapsed;
  }
  if (e.code === 'KeyD' || e.code === 'ArrowRight') {
    if (P.elapsed - lastTapD < 0.28) startFeint(1);
    lastTapD = P.elapsed;
  }
  if (e.code === 'KeyR') respawn();
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyC' && P.stance === 'crouch') tryStand(); // let go -> stand up
});

// camera orbit: drag + pointer-lock on click
let yaw = Math.PI, pitch = -0.32, camDist = 5.2;
let dragging = false, px = 0, py = 0, pointerLocked = false;
canvas.addEventListener('mousedown', (e) => { dragging = true; px = e.clientX; py = e.clientY; });
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  const dx = pointerLocked ? e.movementX : (dragging ? e.clientX - px : 0);
  const dy = pointerLocked ? e.movementY : (dragging ? e.clientY - py : 0);
  if (pointerLocked || dragging) {
    yaw -= dx * 0.0032; pitch -= dy * 0.0028;
    pitch = Math.max(-1.15, Math.min(0.55, pitch));
    px = e.clientX; py = e.clientY;
  }
});
canvas.addEventListener('click', () => {
  if (started && !pointerLocked && !isTouch) canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
window.addEventListener('wheel', (e) => {
  camDist = Math.max(2.6, Math.min(9, camDist + e.deltaY * 0.002));
}, { passive: true });

// touch joystick
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const stick = document.getElementById('stick');
const knob = document.getElementById('stick-knob');
let joyX = 0, joyY = 0, touchSprint = false, touchJumpHeld = false;
if (isTouch) {
  let stickId = null;
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px,${dy}px)`; };
  stick.addEventListener('touchstart', (e) => { stickId = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        const r = stick.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const m = Math.hypot(dx, dy), max = 44;
        if (m > max) { dx *= max / m; dy *= max / m; }
        joyX = dx / max; joyY = dy / max; setKnob(dx, dy);
      }
    }
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; joyX = joyY = 0; setKnob(0, 0); }
  });
  document.getElementById('btn-jump').addEventListener('touchstart', (e) => { jumpQueued = true; touchJumpHeld = true; e.preventDefault(); }, { passive: false });
  document.getElementById('btn-jump').addEventListener('touchend', () => { touchJumpHeld = false; });
  const crouchBtn = document.getElementById('btn-crouch');
  if (crouchBtn) {
    crouchBtn.addEventListener('touchstart', (e) => {
      if (P.grounded && P.speed2d > 5 && P.state === 'ground') startSlide();
      else if (P.stance === 'stand' && (P.state === 'ground' || P.state === 'air')) P.stance = 'crouch';
      e.preventDefault();
    }, { passive: false });
    crouchBtn.addEventListener('touchend', () => { if (P.stance === 'crouch') tryStand(); });
  }
  document.getElementById('btn-vault').addEventListener('touchstart', (e) => { vaultQueued = true; e.preventDefault(); }, { passive: false });
  document.getElementById('btn-sprint').addEventListener('touchstart', (e) => { touchSprint = !touchSprint; e.target.style.background = touchSprint ? '#f5c542' : ''; e.preventDefault(); }, { passive: false });
}

/* ---------------- Desmond — procedural assassin runner ----------------
   Desmond is intentionally the ONLY humanoid in the level. Built from
   primitives so the game runs even without the .blend export. If the
   player exports AC1-Desmond_Miles.blend -> game/desmond.glb in Blender
   (File > Export > glTF, +Y up), it auto-replaces this rig. */
const desmond = new THREE.Group();
const rig = {};
function limbMesh(w, h, d, color, rough = 0.85) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough })
  );
  m.castShadow = true;
  return m;
}
function buildDesmond() {
  const white = 0xe9e7e1, grey = 0x5b6470, denim = 0x2e4a6b,
    skin = 0xd9a17a, red = 0xb3202c, dark = 0x22262c;
  // hips root at ~0.98m
  const hips = new THREE.Group(); hips.position.y = 0.98; desmond.add(hips); rig.hips = hips;
  const torso = limbMesh(0.42, 0.58, 0.26, white); torso.position.y = 0.32; hips.add(torso); rig.torso = torso;
  const sash = limbMesh(0.44, 0.1, 0.28, red, 0.7); sash.position.y = 0.08; hips.add(sash);
  const strap = limbMesh(0.1, 0.55, 0.28, 0x6b4a2f, 0.9); strap.rotation.z = 0.5; strap.position.y = 0.34; hips.add(strap);
  // head + hood
  const neck = new THREE.Group(); neck.position.y = 0.66; hips.add(neck); rig.neck = neck;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 16),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
  face.position.z = 0.03; face.castShadow = true; neck.add(face);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.34, 4),
    new THREE.MeshStandardMaterial({ color: white, roughness: 0.9, flatShading: true }));
  hood.position.set(0, 0.1, -0.05); hood.rotation.y = Math.PI / 4; hood.castShadow = true; neck.add(hood);
  const hoodBack = limbMesh(0.26, 0.3, 0.1, white); hoodBack.position.set(0, -0.02, -0.14); neck.add(hoodBack);
  // arms
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const shoulder = new THREE.Group(); shoulder.position.set(0.27 * s, 0.55, 0); hips.add(shoulder);
    const upper = limbMesh(0.13, 0.34, 0.13, white); upper.position.y = -0.16; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.32; shoulder.add(elbow);
    const fore = limbMesh(0.11, 0.3, 0.11, grey); fore.position.y = -0.14; elbow.add(fore);
    const hand = limbMesh(0.1, 0.12, 0.1, skin); hand.position.y = -0.33; elbow.add(hand);
    // hidden blade on left forearm (Desmond/Assassin signature)
    if (s < 0) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03),
        new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 0.85, roughness: 0.3 }));
      blade.position.set(0, -0.2, 0.08); elbow.add(blade);
    }
    rig['shoulder' + side] = shoulder; rig['elbow' + side] = elbow;
  }
  // legs
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const hipJ = new THREE.Group(); hipJ.position.set(0.13 * s, 0.0, 0); hips.add(hipJ);
    const thigh = limbMesh(0.16, 0.42, 0.16, denim); thigh.position.y = -0.2; hipJ.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.42; hipJ.add(knee);
    const shin = limbMesh(0.14, 0.4, 0.14, denim); shin.position.y = -0.19; knee.add(shin);
    const boot = limbMesh(0.15, 0.12, 0.26, dark); boot.position.set(0, -0.42, 0.05); knee.add(boot);
    rig['hip' + side] = hipJ; rig['knee' + side] = knee;
  }
  // soft blob shadow (helps when sun shadow is far)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; desmond.add(blob); rig.blob = blob;
  desmond.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  desmond.position.set(0, 2, 10);
  scene.add(desmond);
}
buildDesmond();

// real Desmond model (converted from AC1-Desmond_Miles.blend -> desmond.glb).
// It swaps in automatically: auto-scaled to ~1.8 m, feet planted at y=0,
// facing +Z like the procedural rig. If the .glb ships animations
// (run/walk/idle/jump…), they play instead of the procedural pose.
let desmondGLB = null;
const desmondHolder = new THREE.Group();
let desmondFeetY = 0; // inner model offset so feet sit at holder origin
let desmondMixer = null;
const desmondClips = {};
let desmondClipName = null;
let grabFade = 0.22; // crossfade duration: grabs snap faster (set 0.12 on catch)
new GLTFLoader().load('./desmond.glb',
  (g) => {
    desmondGLB = g.scene;
    desmondGLB.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // normalize: height -> 1.8 m, feet -> local y=0
    const box = new THREE.Box3().setFromObject(desmondGLB);
    const h = Math.max(0.001, box.max.y - box.min.y);
    desmondGLB.scale.setScalar(1.8 / h);
    const box2 = new THREE.Box3().setFromObject(desmondGLB);
    desmondGLB.position.y -= box2.min.y;
    desmondFeetY = desmondGLB.position.y;
    desmondHolder.add(desmondGLB);
    scene.add(desmondHolder);
    desmond.visible = false;
    // animations, if any (base weights stay 1 — see desmondTickMixer)
    if (g.animations && g.animations.length) {
      desmondMixer = new THREE.AnimationMixer(desmondGLB);
      for (const clip of g.animations) {
        desmondClips[clip.name] = desmondMixer.clipAction(clip);
      }
      const names = Object.keys(desmondClips).join(', ');
      console.log('[Desmond] animations:', names);
      toast('Desmond loaded — with animations: ' + names);
    } else {
      toast('Desmond model loaded from desmond.glb');
    }
  },
  undefined, () => {
    console.log('No desmond.glb found — using stylized Desmond rig.');
    toast('desmond.glb missing — stylized stand-in active');
  });
function desmondWantClip() {
  const names = Object.keys(desmondClips);
  if (!names.length) return null;
  const find = (...kws) => names.find((n) => kws.some((k) => n.toLowerCase().includes(k)));
  if (P.state === 'hang') return find('hang', 'ledge', 'grab') || find('jump', 'air') || names[0];
  // scripted moves keep their clip for their whole duration, air or ground
  if (P.state === 'feint') return find('dodge', 'feint', 'juke') || find('run', 'sprint') || names[0];
  if (P.state === 'slide' || P.stance === 'slide') return find('slide') || find('crouch', 'dive', 'jump') || names[0];
  if (P.state === 'climbwall') {
    const climbing = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
      keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'] ||
      Math.abs(joyX) > 0.15 || Math.abs(joyY) > 0.15;
    // still on the wall: cling to the holds; moving: climb cycle
    if (climbing) return find('climb') || find('jump', 'air') || names[0];
    return find('hold', 'cling', 'grip', 'rest') || find('climb') || find('jump', 'air') || names[0];
  }
  if (P.state === 'climb') return find('climb') || find('jump', 'air') || names[0];
  if (P.state === 'vault' || P.state === 'wallrun') return find('jump', 'run', 'sprint') || names[0];
  if (!P.grounded) {
    if (P.vel.y < -9 || P.diveFlag) return find('dive', 'leap', 'faith', 'spread') || find('jump', 'air', 'fall') || names[0];
    // split jump: rising extends, falling tucks (no more looping crouch mid-air)
    if (P.vel.y > 1) return find('rise', 'takeoff', 'jump-up') || find('jump', 'air') || names[0];
    return find('fall', 'drop', 'airborne') || find('jump', 'air', 'fall', 'leap', 'flip') || names[0];
  }
  if (P.speed2d > 6.5) return find('run', 'sprint', 'sprint_', 'jog') || find('walk') || names[0];
  // NOTE: 'walk' must be tested before 'run' — 'Desmond_Run' contains 'run'
  // and would otherwise shadow the Walk clip forever.
  if (P.stance === 'prone') return find('prone', 'crawl') || find('dive', 'jump') || names[0];
  if (P.stance === 'crouch' && P.grounded) return find('crouch') || find('walk') || names[0];
  if (P.speed2d > 0.8) return find('walk') || find('jog') || find('run') || names[0];
  return find('idle', 'stand', 'breath', 'pose') || names[0];
}
function desmondTickMixer(dt) {
  if (!desmondMixer) return;
  const want = desmondWantClip();
  if (want && want !== desmondClipName) {
    // three.js fades MULTIPLY the action's base weight (_updateWeight:
    // effective = weight × fadeRamp), so the incoming clip's base weight
    // must be 1 first — a base of 0 would stay silent forever.
    const fade = grabFade; grabFade = 0.22;
    const prev = desmondClipName && desmondClips[desmondClipName];
    if (prev) prev.fadeOut(fade);
    desmondClipName = want;
    const a = desmondClips[want];
    a.reset();
    a.weight = 1;
    a.fadeIn(fade);
    a.play();
  }
  const cur = desmondClipName && desmondClips[desmondClipName];
  if (cur) {
    // stride-matched playback so feet stop skating: walk loop ~2 m,
    // run loop ~4 m per 0.8 s cycle.
    const n = desmondClipName.toLowerCase();
    if (n.includes('walk')) cur.timeScale = Math.max(0.6, Math.min(1.3, P.speed2d / 2.0));
    else if (n.includes('run') || n.includes('sprint') || n.includes('jog')) cur.timeScale = Math.max(0.7, Math.min(2.0, P.speed2d / 4.0));
    else cur.timeScale = 1;
  }
  desmondMixer.update(dt);
}

/* ---------------- world: ground + city + colliders ---------------- */
const cityGroup = new THREE.Group(); scene.add(cityGroup);
const solidMeshes = [];   // ground plane + hay (joined with the city into collidables)
const cityHitMeshes = []; // heavy visual meshes, raycast ONLY at startup

const groundMat = new THREE.MeshStandardMaterial({ color: 0x9a8f78, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground); solidMeshes.push(ground);

// leap-of-faith hay + banners (decor only — Desmond is the only character)
const hayMat = new THREE.MeshStandardMaterial({ color: 0xd9a83c, roughness: 1 });
// dust + straw puffs: one pooled Points system for landings, steps,
// wall kicks, slides and hay bursts (visual only)
const PUFF_N = 240;
const puffGeo = new THREE.BufferGeometry();
const puffPos = new Float32Array(PUFF_N * 3);
const puffCol = new Float32Array(PUFF_N * 3);
const puffVel = new Float32Array(PUFF_N * 3);
const puffLife = new Float32Array(PUFF_N);
for (let i = 0; i < PUFF_N; i++) { puffPos[i * 3 + 1] = -999; }
puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3));
puffGeo.setAttribute('color', new THREE.BufferAttribute(puffCol, 3));
const puffPts = new THREE.Points(puffGeo, new THREE.PointsMaterial({
  size: 0.55, vertexColors: true, transparent: true, opacity: 0.5,
  depthWrite: false, sizeAttenuation: true,
}));
puffPts.frustumCulled = false;
scene.add(puffPts);
let puffCursor = 0;
const _puffC = new THREE.Color();
function spawnPuff(x, y, z, n, colorHex, spread = 1.2, up = 1.5, life = 0.7) {
  _puffC.setHex(colorHex);
  for (let k = 0; k < n; k++) {
    const i = puffCursor; puffCursor = (puffCursor + 1) % PUFF_N;
    puffPos[i * 3] = x + (Math.random() - 0.5) * 0.4;
    puffPos[i * 3 + 1] = y + Math.random() * 0.2;
    puffPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
    puffVel[i * 3] = (Math.random() - 0.5) * spread * 2;
    puffVel[i * 3 + 1] = Math.random() * up;
    puffVel[i * 3 + 2] = (Math.random() - 0.5) * spread * 2;
    puffCol[i * 3] = _puffC.r; puffCol[i * 3 + 1] = _puffC.g; puffCol[i * 3 + 2] = _puffC.b;
    puffLife[i] = life * (0.7 + Math.random() * 0.6);
  }
  puffGeo.attributes.color.needsUpdate = true;
}
function updatePuffs(dt) {
  let any = false;
  for (let i = 0; i < PUFF_N; i++) {
    if (puffLife[i] <= 0) continue;
    any = true;
    puffLife[i] -= dt;
    if (puffLife[i] <= 0) { puffPos[i * 3 + 1] = -999; continue; }
    puffPos[i * 3] += puffVel[i * 3] * dt;
    puffPos[i * 3 + 1] += puffVel[i * 3 + 1] * dt;
    puffPos[i * 3 + 2] += puffVel[i * 3 + 2] * dt;
    puffVel[i * 3] *= (1 - dt * 1.5); puffVel[i * 3 + 2] *= (1 - dt * 1.5);
    puffVel[i * 3 + 1] -= dt * 1.2;
  }
  if (any) puffGeo.attributes.position.needsUpdate = true;
}

// hay bale squash + straw burst on catches
let hayMesh = null;
let haySquash = 0;
function addHay(x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.0, 18), hayMat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  scene.add(m); solidMeshes.push(m);
  addHayBody(x, y, z); // cannon-es static collider twin
  if (!hayMesh) hayMesh = m;
  return m;
}
// banners / flags for life (not characters) — cloth waves every frame
const flags = [];
const flagMatCache = {};
function flagMaterial(color) {
  if (!flagMatCache[color]) {
    flagMatCache[color] = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  }
  return flagMatCache[color];
}
function addFlagWave(x, topY, z, color, w = 1.6, h = 1.0, poleH = 6) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, poleH, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 }));
  pole.position.set(x, topY - poleH / 2, z); pole.castShadow = true; scene.add(pole);
  const geo = new THREE.PlaneGeometry(w, h, 8, 4);
  geo.translate(w / 2, 0, 0); // hinge along the pole edge
  const m = new THREE.Mesh(geo, flagMaterial(color));
  m.position.set(x, topY - h / 2 - 0.15, z);
  m.rotation.y = Math.random() * Math.PI * 2;
  scene.add(m);
  flags.push({ mesh: m, base: geo.attributes.position.array.slice(), phase: Math.random() * 9, w });
  return m;
}
function updateFlags(t) {
  for (const f of flags) {
    const attr = f.mesh.geometry.attributes.position;
    const arr = attr.array, base = f.base;
    for (let i = 0; i < arr.length; i += 3) {
      const k = base[i] / f.w; // 0 at pole -> 1 at fly end
      arr[i + 2] = Math.sin(base[i] * 4 - t * 7 + f.phase) * 0.14 * k;
      arr[i + 1] = base[i + 1] + Math.sin(base[i] * 2.5 - t * 5 + f.phase) * 0.05 * k;
    }
    attr.needsUpdate = true;
  }
}
function addBanner(x, y, z, color) {
  addFlagWave(x, y + 5.7, z, color, 1.6, 1.0, 6);
}
// pennants on the high towers mark the climbing lines (decor, non-solid)
function placePennants() {
  const c = cityBox.getCenter(new THREE.Vector3());
  const pr = new THREE.Raycaster(); pr.firstHitOnly = true;
  const spots = [[0, 0], [28, 10], [-24, 18], [12, -26], [-14, -12], [30, -8], [-30, -2]];
  let planted = 0;
  for (const [ox, oz] of spots) {
    tmpV.set(c.x + ox, cityBox.max.y + 10, c.z + oz);
    pr.set(tmpV, V_DOWN); pr.far = cityBox.max.y - cityBox.min.y + 20;
    const hit = pr.intersectObjects(collidables, false)[0];
    if (hit && hit.point.y > cityBox.min.y + 4) {
      addFlagWave(hit.point.x, hit.point.y + 3.0, hit.point.z,
        planted % 2 ? 0xb3202c : 0xe9e7e1, 1.4, 0.9, 3.2);
      planted++;
    }
  }
  console.log(`[dressing] pennants planted: ${planted}`);
}

// circling bird silhouettes — AC's living weathervanes over towers and leaps
const flocks = [];
function addFlock(cx, cy, cz, r, count, speed) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x1c2126, side: THREE.DoubleSide });
  const birds = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const gl = new THREE.PlaneGeometry(0.55, 0.22);
    gl.rotateX(-Math.PI / 2); gl.translate(-0.275, 0, 0);
    const gr = new THREE.PlaneGeometry(0.55, 0.22);
    gr.rotateX(-Math.PI / 2); gr.translate(0.275, 0, 0);
    const wl = new THREE.Mesh(gl, mat), wr = new THREE.Mesh(gr, mat);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), mat);
    g.add(wl); g.add(wr); g.add(body);
    scene.add(g);
    birds.push({
      g, wl, wr,
      a: Math.random() * Math.PI * 2,
      r: r * (0.8 + Math.random() * 0.4),
      h: (Math.random() - 0.5) * 3,
      sp: speed * (0.85 + Math.random() * 0.3),
      fl: 9 + Math.random() * 3, ph: Math.random() * 9,
    });
  }
  flocks.push({ c: new THREE.Vector3(cx, cy, cz), birds });
}
function updateBirds(t, dt) {
  for (const f of flocks) {
    for (const b of f.birds) {
      b.a += (b.sp / b.r) * dt;
      b.g.position.set(
        f.c.x + Math.cos(b.a) * b.r,
        f.c.y + b.h + Math.sin(t * 0.9 + b.ph) * 0.8,
        f.c.z + Math.sin(b.a) * b.r
      );
      b.g.rotation.y = -b.a;
      const flap = Math.sin(t * b.fl + b.ph) * 0.65;
      b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
    }
  }
}

// free-run: no checkpoints, no timers to beat — the rooftops are the course

let cityBox = new THREE.Box3(
  new THREE.Vector3(-40, 0, -40), new THREE.Vector3(40, 25, 40));
let spawnPoint = new THREE.Vector3(0, 1.5, 10);

// Exact body-vs-town resolution (BVH wall slide). The old AABB push-out is
// gone: horizontal motion probes the real polygons along the travel path at
// knee + chest height, steps onto ledges ≤0.55 m (sticky ground lifts after),
// otherwise slides along the exact wall face and kills into-wall velocity —
// so Desmond can never end up *inside* masonry, and archways/alleys stay open.
const PLAYER_R = 0.3; // body radius kept off the stone
const _stepRay = new THREE.Raycaster();
_stepRay.firstHitOnly = true;
const _dropRay = new THREE.Raycaster();
_dropRay.firstHitOnly = true;
const _edgeRay = new THREE.Raycaster();
_edgeRay.firstHitOnly = true;
const _feetRay = new THREE.Raycaster();
_feetRay.firstHitOnly = true;
const _slideDir = new THREE.Vector3(), _slideN = new THREE.Vector3();
function slideDisplacement(dx, dz, ox = P.pos.x, oz = P.pos.z) {
  const slideHeights = stanceNums().slide;
  let mx = dx, mz = dz;
  for (let iter = 0; iter < 2; iter++) {
    const len = Math.hypot(mx, mz);
    if (len < 1e-6) return { x: 0, z: 0 };
    _slideDir.set(mx / len, 0, mz / len);
    let nearest = null;
    for (const h of slideHeights) {
      tmpV2.set(ox, P.pos.y + h, oz);
      rayFwd.set(tmpV2, _slideDir); rayFwd.far = len + PLAYER_R;
      const hit = rayFwd.intersectObjects(collidables, false)[0];
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    if (!nearest) return { x: mx, z: mz };
    // step-up? sample the top just beyond the face
    tmpV.set(ox, P.pos.y, oz); tmpV.x += _slideDir.x * (nearest.distance + 0.15); tmpV.z += _slideDir.z * (nearest.distance + 0.15); tmpV.y += 2.5;
    _stepRay.set(tmpV, V_DOWN); _stepRay.far = 4.2;
    const top = _stepRay.intersectObjects(collidables, false)[0];
    if (top && top.point.y - P.pos.y <= 0.55) return { x: mx, z: mz };
    // slide along the exact face
    if (nearest.face) _slideN.copy(nearest.face.normal).transformDirection(nearest.object.matrixWorld);
    else _slideN.copy(_slideDir).negate();
    _slideN.y = 0;
    if (_slideN.lengthSq() < 0.01) return { x: 0, z: 0 };
    _slideN.normalize();
    const into = P.vel.x * _slideN.x + P.vel.z * _slideN.z;
    if (into < 0) { P.vel.x -= _slideN.x * into; P.vel.z -= _slideN.z * into; }
    const allowed = Math.max(0, nearest.distance - PLAYER_R);
    if (allowed >= len) return { x: mx, z: mz };
    const s = allowed / len;
    mx *= s; mz *= s;
  }
  return { x: mx, z: mz };
}

// One cannon-es dynamics step with BVH wall correction: the rigid body
// integrates controller velocity + gravity + contacts, then the travelled
// XZ segment is slide-corrected against the real polygons from its origin.
function physicsStep(h) {
  const ox = P.pos.x, oy = P.pos.y, oz = P.pos.z;
  const s = stepBody(ox, oy, oz, P.vel.x, P.vel.y, P.vel.z, h);
  P.pos.set(s.x, s.y, s.z);
  P.vel.set(s.vx, s.vy, s.vz);
  const d = slideDisplacement(P.pos.x - ox, P.pos.z - oz, ox, oz);
  P.pos.x = ox + d.x; P.pos.z = oz + d.z;
}

async function loadCity(onProgress) {
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync('../scene.gltf', (ev) => {
      if (ev.total) onProgress(ev.loaded / ev.total);
    });
    const root = gltf.scene;
    // authored scale (1 unit = 1 m): the town renders life-size next to the
    // 1.8 m Desmond — walls, doors and holds at true proportions.
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    box.getCenter(center);
    root.position.x -= center.x; root.position.z -= center.z; root.position.y -= box.min.y;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        cityHitMeshes.push(o);
        // crisp stonework at grazing angles on the big town
        if (o.material && o.material.map) {
          o.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        // fix unlit sketchfab material being too flat: keep but enable vertex colors
        if (o.material && o.material.isMeshStandardMaterial) o.material.roughness = 0.95;
      }
    });
    cityGroup.add(root);
    cityBox.setFromObject(root);
    return true;
  } catch (err) {
    console.warn('City load failed, using fallback rooftops:', err);
    return false;
  }
}

// Exact per-triangle collision, baked ONCE at startup from the real geometry.
// Every probe in the game — ground, walls, vault/mantle tops, climb faces,
// ledge grabs, camera — raycasts the actual townscape polygons through BVH
// acceleration (three-mesh-bvh), so Desmond stands on exactly what you see:
// roof decks (not parapet tops), sheds, streets, tower floors. No proxies.
let viewpoint = new THREE.Vector3(0, 3, 0); // highest vertex = Assassin viewpoint
const collidables = []; // city BVH meshes + ground plane + hay (every probe reads this)
async function buildCityColliders(onProgress) {
  cityGroup.updateMatrixWorld(true);
  // viewpoint = highest vertex of the town (tallest tower)
  const v = new THREE.Vector3();
  let best = -Infinity;
  const bp = new THREE.Vector3();
  for (const mesh of cityHitMeshes) {
    const attr = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (!attr) continue;
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      if (v.y > best) { best = v.y; bp.set(v.x, v.y, v.z); }
    }
  }
  if (isFinite(best)) viewpoint.copy(bp);
  console.log(`[colliders] viewpoint y=${best.toFixed(1)} — building BVH over ${cityHitMeshes.length} meshes…`);
  // one BVH per town chunk; yields between chunks keep the loading screen alive
  const t0 = performance.now();
  for (let i = 0; i < cityHitMeshes.length; i++) {
    if (onProgress) onProgress(i / cityHitMeshes.length);
    await new Promise((r) => setTimeout(r, 30));
    cityHitMeshes[i].geometry.boundsTree = new MeshBVH(cityHitMeshes[i].geometry);
  }
  console.log(`[colliders] BVH built in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  // town survey: map every structure (towers, houses, low works, windows get
  // no special case — sills and tunnel floors are ordinary polygons now)
  for (const mesh of cityHitMeshes) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const sz = bb.getSize(new THREE.Vector3());
    const tris = Math.round((mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3);
    const tag = sz.y > 28 ? 'tower' : sz.y > 12 ? 'house' : sz.y > 4 ? 'lowworks' : 'groundwork';
    console.log(`[survey] ${tag} top=${bb.max.y.toFixed(1)} size=${sz.x.toFixed(0)}x${sz.y.toFixed(0)}x${sz.z.toFixed(0)} tris=${tris}`);
  }
  collidables.push(...cityHitMeshes, ...solidMeshes);
}

function buildCourse() {
  const c = cityBox.getCenter(new THREE.Vector3());
  // pure free-run: no checkpoints, no scaffold — just the hay bale,
  // banners, and the viewpoint spawn.
  addHay(c.x, 0.5, c.z); // leap-of-faith hay bale in the middle
  haySpots.push({ x: c.x, z: c.z });
  addBanner(c.x + 22, 0, c.z, 0xb3202c);
  addBanner(c.x - 22, 0, c.z, 0xe9e7e1);
  placePennants(); // waving route-markers on the high towers
  addFlock(viewpoint.x, viewpoint.y + 7, viewpoint.z, 12, 5, 6); // viewpoint swifts
  addFlock(c.x, Math.max(20, cityBox.max.y * 0.8), c.z, 20, 6, 5); // high city circlers
  addFlock(c.x, 9, c.z, 10, 4, 7); // hay-plaza birds mark the leap
  // Desmond starts on the viewpoint: the highest tower, facing the city.
  spawnPoint.set(viewpoint.x, viewpoint.y + 1.2, viewpoint.z);
}

function buildFallbackCity() {
  // grey-box Monteriggioni impression if gltf missing (file:// etc.)
  cityBox = new THREE.Box3(new THREE.Vector3(-45, 0, -45), new THREE.Vector3(45, 20, 45));
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcbbfa5, roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xa2543a, roughness: 1 });
  for (let i = 0; i < 10; i++) {
    const w = 6 + (i % 3) * 2, h = 6 + ((i * 7) % 8), d = 6 + ((i * 3) % 4);
    const x = -30 + (i % 5) * 14, z = -20 + Math.floor(i / 5) * 22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true;
    scene.add(b); solidMeshes.push(b); cityHitMeshes.push(b);
    const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.4, 4), roofMat);
    r.position.set(x, h + 1.2, z); r.rotation.y = Math.PI / 4; r.castShadow = true; scene.add(r);
  }
}

/* ---------------- player state ---------------- */
const P = {
  pos: new THREE.Vector3(0, 2, 10),
  vel: new THREE.Vector3(),
  faceYaw: 0, // where Desmond faces
  grounded: true, // spawns standing (first probe corrects the 1.2 m drop-in)
  coyote: 0, jumpBuf: 0,
  stamina: 1,
  state: 'ground', stateT: 0,
  wallSide: 0, wallNormal: new THREE.Vector3(),
  climbFrom: new THREE.Vector3(), climbTo: new THREE.Vector3(),
  vaultFrom: new THREE.Vector3(), vaultTo: new THREE.Vector3(),
  hangNormal: new THREE.Vector3(), hangTop: new THREE.Vector3(), hangCool: 0, hintHangCool: 0,
  climbBaseY: 0, feintDir: 0, feintCool: 0, diveFlag: false,
  blockedT: 0,
  slideDir: new THREE.Vector3(0, 0, 1), dropCool: 0, feetRoll: 0, feetLift: 0,
  stance: 'stand', // stand | crouch | prone | slide — tunnels need small bodies
  runPhase: 0, speed2d: 0,
  fallTop: 0, stepAcc: 0,
  startTime: 0, elapsed: 0,
};
const haySpots = []; // {x, z} leap-of-faith targets
let started = false;

function respawn() {
  P.pos.copy(spawnPoint);
  P.vel.set(0, 0, 0); P.grounded = false; P.state = 'air'; P.stateT = 0;
  P.stamina = 1; P.wallSide = 0; P.stance = 'stand';
  P.diveFlag = false; P.hangCool = 0; P.feintCool = 0; P.dropCool = 0;
  P.fallTop = spawnPoint.y; P.jumpBuf = 0;
  toast('Respawned');
}

// sprint slide (DPS VaultSlide port): feet-first powerslide under low bars
// and through tunnels — committed 0.7 s, flows back into the sprint
function startSlide() {
  if (!started || P.state !== 'ground' || !P.grounded) return;
  if (P.speed2d < 5) return;
  P.state = 'slide'; P.stateT = 0;
  P.slideDir.set(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw));
  P.stance = 'slide';
  P.stamina = Math.max(0, P.stamina - 0.05);
  sfx.slide(); popup('SLIDE!');
}

// sprint feint: a 0.32 s lateral juke (Q / E / double-tap A,D while sprinting)
function startFeint(dir) {
  if (!started || P.state === 'feint' || P.feintCool > 0) return;
  if (P.state !== 'ground' && P.state !== 'air') return; // never hijack climbs/hangs/slides
  if (!P.grounded || P.speed2d < 5) return;
  P.state = 'feint'; P.stateT = 0;
  P.feintDir = dir;
  P.feintCool = 0.9;
  P.stamina = Math.max(0, P.stamina - 0.08);
  sfx.feint(); popup(dir < 0 ? 'FEINT LEFT!' : 'FEINT RIGHT!');
}

const rayDown = new THREE.Raycaster();
rayDown.firstHitOnly = true; // BVH closest-hit early-out
const rayFwd = new THREE.Raycaster();
rayFwd.firstHitOnly = true;
const V_DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

// stance geometry: crouch (1.05 m) and prone (0.5 m) fit tunnels and
// window reveals that standing (1.8 m) cannot enter. Probes, camera and
// speeds all read from here so the small bodies collide correctly.
function stanceNums() {
  if (P.stance === 'prone') return { chest: 0.35, knee: 0.15, head: 0.6, origin: 0.5, slide: [0.4, 0.15], camHead: 0.55, camLook: 0.4, speed: 0.8 };
  if (P.stance === 'crouch') return { chest: 0.8, knee: 0.3, head: 1.15, origin: 0.9, slide: [0.8, 0.3], camHead: 1.0, camLook: 0.9, speed: 1.3 };
  if (P.stance === 'slide') return { chest: 0.5, knee: 0.2, head: 0.75, origin: 0.6, slide: [0.35, 0.15], camHead: 0.8, camLook: 0.7, speed: null };
  return { chest: 1.3, knee: 0.5, head: 2.2, origin: 1.0, slide: [1.2, 0.45], camHead: 1.7, camLook: 1.45, speed: null };
}
const _standRay = new THREE.Raycaster();
_standRay.firstHitOnly = true;
// stand up if there is room (1.9 m); else sit up to crouch (1.15 m); else stay
function tryStand() {
  if (P.stance === 'stand') return true;
  tmpV.copy(P.pos); tmpV.y += 0.1;
  _standRay.set(tmpV, UP); _standRay.far = 1.9;
  if (!_standRay.intersectObjects(collidables, false).length) {
    P.stance = 'stand'; return true;
  }
  _standRay.far = 1.15;
  if (!_standRay.intersectObjects(collidables, false).length) {
    P.stance = 'crouch'; toast('Low ceiling — crouching'); return false;
  }
  toast('No room — stay low');
  return false;
}

function groundProbe() {
  const SN = stanceNums();
  tmpV.copy(P.pos); tmpV.y += SN.origin;
  rayDown.set(tmpV, V_DOWN); rayDown.far = 2.6;
  const hits = rayDown.intersectObjects(collidables, false);
  return hits.length ? hits[0] : null;
}
function forwardProbe(height, dist, dirYaw) {
  tmpV2.copy(P.pos); tmpV2.y += height;
  tmpV3.set(Math.sin(dirYaw), 0, Math.cos(dirYaw));
  rayFwd.set(tmpV2, tmpV3); rayFwd.far = dist;
  const hits = rayFwd.intersectObjects(collidables, false);
  return hits.length ? hits[0] : null;
}

function popup(text) {
  popupEl.textContent = text;
  popupEl.classList.remove('show'); void popupEl.offsetWidth;
  popupEl.classList.add('show');
  clearTimeout(popupEl._t);
  popupEl._t = setTimeout(() => popupEl.classList.remove('show'), 900);
}
let toastTimer = 0;
function toast(text, ms = 2400) {
  toastEl.textContent = text; toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ---------------- per-frame update ---------------- */
const clock = new THREE.Clock();

function updatePlayer(dt) {
  // input dir (camera relative)
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  ix += joyX; iz -= joyY;
  const il = Math.hypot(ix, iz);
  if (il > 1) { ix /= il; iz /= il; }
  const wantSprint = !!(keys['ShiftLeft'] || keys['ShiftRight'] || touchSprint);
  // AC gaits: deliberate walk by default, committed sprint on Shift.
  const WALK = 2.4, RUN = 8.0;
  const SN = stanceNums();
  // sprinting stands you up first (if there is headroom)
  if (wantSprint && P.stance !== 'stand') tryStand();
  const sprinting = wantSprint && P.stance === 'stand' && P.stamina > 0.05 && il > 0.1;
  if (sprinting && P.grounded) P.stamina = Math.max(0, P.stamina - dt * 0.08);
  else P.stamina = Math.min(1, P.stamina + dt * (P.grounded ? 0.35 : 0.15));

  const maxSpeed = P.stance === 'prone' ? SN.speed : P.stance === 'crouch' ? SN.speed : (sprinting ? RUN : WALK);
  // world-space wish dir (camera-relative: W = away from camera)
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const wish = new THREE.Vector3(ix * cos - iz * sin, 0, -ix * sin - iz * cos);
  wish.applyAxisAngle(UP, Math.PI);
  if (wish.lengthSq() > 0.001) {
    const targetYaw = Math.atan2(wish.x, wish.z);
    let d = targetYaw - P.faceYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // slow, arcing turns at sprint — but snap around fast when reversing,
    // so S always feels like a brake and WASD stays exactly mapped
    const turnRate = !P.grounded ? 9 : (sprinting ? (Math.abs(d) > 1.75 ? 11 : 6.5) : 14);
    P.faceYaw += d * Math.min(1, dt * turnRate);
  }

  if (P.grounded) P.fallTop = P.pos.y;
  P.hangCool = Math.max(0, P.hangCool - dt);
  P.hintHangCool = Math.max(0, P.hintHangCool - dt);
  P.feintCool = Math.max(0, P.feintCool - dt);

  // footsteps sell the gait (stride ~1.6 m)
  if (P.grounded && P.speed2d > 0.6 && P.state === 'ground') {
    P.stepAcc += P.speed2d * dt;
    if (P.stepAcc > 1.6) {
      P.stepAcc = 0; sfx.step();
      if (P.speed2d > 5) spawnPuff(P.pos.x, P.pos.y + 0.1, P.pos.z, 2, 0xcfc4ae, 0.8, 0.5, 0.4);
    }
  } else P.stepAcc = 0;

  if (jumpQueued) { P.jumpBuf = 0.15; jumpQueued = false; }
  else P.jumpBuf = Math.max(0, P.jumpBuf - dt);

  const wallFwd = forwardProbe(SN.chest, 1.1, P.faceYaw);
  // knee lookahead grows with speed so sprint vaults trigger before contact
  const wallKnee = forwardProbe(SN.knee, 1.0 + P.speed2d * 0.12, P.faceYaw);

  // --- state machines ---
  P.stateT += dt;
  const GRAV = -24, JUMP = 9.0;

  if (P.state === 'climb') {
    const t = Math.min(1, P.stateT / 0.55);
    P.pos.lerpVectors(P.climbFrom, P.climbTo, t * t * (3 - 2 * t));
    P.vel.set(0, 0, 0);
    if (t >= 1) { P.state = P.grounded ? 'ground' : 'air'; P.coyote = 0.12; }
  } else if (P.state === 'vault') {
    const t = Math.min(1, P.stateT / 0.45);
    P.pos.lerpVectors(P.vaultFrom, P.vaultTo, t);
    P.pos.y += Math.sin(t * Math.PI) * 0.9;
    if (t >= 1) { P.state = 'air'; P.coyote = 0.12; P.vel.y = 2.5; }
  } else if (P.state === 'hang') {
    // hanging from a ledge by the hands: shimmy, pull up, or drop
    P.vel.set(0, 0, 0);
    P.stamina = Math.max(0, P.stamina - dt * 0.06);
    const wantYaw = Math.atan2(-P.hangNormal.x, -P.hangNormal.z);
    let dh = wantYaw - P.faceYaw;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    P.faceYaw += dh * Math.min(1, dt * 10);
    let lat = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) lat -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) lat += 1;
    lat += joyX;
    if (Math.abs(lat) > 0.15 && P.stamina > 0) {
      const tx = -P.hangNormal.z, tz = P.hangNormal.x;
      const ox = P.pos.x, oz = P.pos.z;
      P.pos.x += tx * lat * 1.7 * dt; P.pos.z += tz * lat * 1.7 * dt;
      if (!hangHolds(P.pos)) { P.pos.x = ox; P.pos.z = oz; }
      else P.stamina = Math.max(0, P.stamina - dt * 0.03);
    }
    if (P.stamina <= 0) dropFromHang();
    else if (keys['KeyS'] || keys['ArrowDown']) dropFromHang();
    else if (keys['KeyE']) {
      // leap out: push off into a dive (AC leap-from-hang)
      vaultQueued = false;
      P.vel.copy(P.hangNormal).multiplyScalar(3); P.vel.y = 1.5;
      P.state = 'air'; P.diveFlag = true; P.hangCool = 0.6; P.jumpBuf = 0;
      sfx.jump();
    }
    else if (keys['KeyW'] || keys['ArrowUp'] || keys['Space'] || P.jumpBuf > 0) {
      // pull up onto the ledge
      P.jumpBuf = 0;
      P.state = 'climb'; P.stateT = 0;
      P.climbFrom.copy(P.pos);
      P.climbTo.copy(P.hangTop).addScaledVector(P.hangNormal, -0.35);
      P.climbTo.y = P.hangTop.y + 0.05;
      P.hangCool = 0.6;
      sfx.climb(); popup('PULL UP!');
      spawnPuff(P.pos.x, P.pos.y + 1.0, P.pos.z, 4, 0xcfc4ae, 0.8, 0.6, 0.4);
    }
  } else if (P.state === 'climbwall') {
    // sustained Assassin's climb: W up, S down, A/D across, Space jumps off
    const fwd = new THREE.Vector3(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw));
    tmpV2.copy(P.pos); tmpV2.y += 1.2;
    rayFwd.set(tmpV2, fwd); rayFwd.far = 1.4;
    const w = rayFwd.intersectObjects(collidables, false)[0];
    if (!w) { P.state = 'air'; P.coyote = 0.1; } // wall ended under our hands
    else {
      P.wallNormal.copy(wallNormalFrom(w));
      P.pos.x = w.point.x - fwd.x * 0.45;
      P.pos.z = w.point.z - fwd.z * 0.45;
      P.faceYaw = Math.atan2(-P.wallNormal.x, -P.wallNormal.z);
      let up = 0, lat = 0;
      if (keys['KeyW'] || keys['ArrowUp']) up += 1;
      if (keys['KeyS'] || keys['ArrowDown']) up -= 1;
      if (keys['KeyA'] || keys['ArrowLeft']) lat -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) lat += 1;
      up += -joyY; lat += joyX;
      if (Math.abs(up) > 0.15 || Math.abs(lat) > 0.15) {
        const tx = -P.wallNormal.z, tz = P.wallNormal.x;
        const oy = P.pos.y, ox = P.pos.x, oz = P.pos.z;
        P.pos.y += up * 2.2 * dt;
        P.pos.x += tx * lat * 1.8 * dt; P.pos.z += tz * lat * 1.8 * dt;
        P.stamina = Math.max(0, P.stamina - dt * (up > 0.15 ? 0.09 : 0.035));
        tmpV2.copy(P.pos); tmpV2.y += 1.2;
        rayFwd.set(tmpV2, fwd); rayFwd.far = 1.4;
        if (!rayFwd.intersectObjects(collidables, false).length) {
          P.pos.y = oy; P.pos.x = ox; P.pos.z = oz; // ran off the climbable face
        }
      } else {
        P.stamina = Math.max(0, P.stamina - dt * 0.02);
      }
      if (P.stamina <= 0) {
        // grip gave out -> slip (you may still catch a lower ledge on the way down)
        P.state = 'air'; P.vel.set(0, -1, 0); P.hangCool = 0.3; sfx.land();
      } else if (P.pos.y - P.climbBaseY > 12) {
        // arms give out ~12 m up a sheer face (scaled to the life-size town)
        tmpV.copy(P.pos).addScaledVector(fwd, 0.55); tmpV.y += 2.6;
        const prCap = new THREE.Raycaster(tmpV.clone(), V_DOWN); prCap.far = 3.2;
        const cap = prCap.intersectObjects(collidables, false)[0];
        if (cap && cap.point.y >= P.pos.y + 1.1 && cap.point.y <= P.pos.y + 2.4) {
          P.state = 'climb'; P.stateT = 0;
          P.climbFrom.copy(P.pos);
          P.climbTo.copy(cap.point); P.climbTo.y += 0.05;
          P.climbTo.addScaledVector(fwd, 0.45);
          P.vel.set(0, 0, 0); P.hangCool = 0.5;
          sfx.climb(); popup('PULL UP!');
      spawnPuff(P.pos.x, P.pos.y + 1.0, P.pos.z, 4, 0xcfc4ae, 0.8, 0.6, 0.4);
        } else {
          P.state = 'air'; P.vel.set(0, -1, 0); P.hangCool = 0.3;
          popup('ARMS GAVE OUT!'); sfx.land();
        }
      } else {
        // hands reached the top? pull up automatically
        tmpV.copy(P.pos).addScaledVector(fwd, 0.55); tmpV.y += 2.6;
        const prT = new THREE.Raycaster(tmpV.clone(), V_DOWN); prT.far = 3.2;
        const th = prT.intersectObjects(collidables, false)[0];
        if (th && th.point.y >= P.pos.y + 1.1 && th.point.y <= P.pos.y + 2.4) {
          P.state = 'climb'; P.stateT = 0;
          P.climbFrom.copy(P.pos);
          P.climbTo.copy(th.point); P.climbTo.y += 0.05;
          P.climbTo.addScaledVector(fwd, 0.45);
          P.vel.set(0, 0, 0); P.hangCool = 0.5;
          sfx.climb(); popup('PULL UP!');
      spawnPuff(P.pos.x, P.pos.y + 1.0, P.pos.z, 4, 0xcfc4ae, 0.8, 0.6, 0.4);
        } else if (P.jumpBuf > 0) {
          // wall eject
          P.jumpBuf = 0;
          P.vel.copy(P.wallNormal).multiplyScalar(5.5); P.vel.y = 7.8;
          P.state = 'air'; P.hangCool = 0.4;
          sfx.jump(); popup('WALL EJECT!');
          spawnPuff(P.pos.x, P.pos.y + 1.0, P.pos.z, 6, 0xcfc4ae, 1.2, 0.8, 0.5);
        }
      }
    }
  } else if (P.state === 'slide') {
    // feet-first powerslide: committed direction + speed, cannon gravity,
    // BVH slide, ground snap; jump cancels out, timer flows back to run
    const T = 0.7, t = P.stateT / T;
    const sp = Math.max(5.0, P.speed2d * (1 - dt * 0.8));
    P.vel.x = P.slideDir.x * sp; P.vel.z = P.slideDir.z * sp;
    physicsStep(dt);
    snapGround();
    if (Math.random() < dt * 14) spawnPuff(P.pos.x, P.pos.y + 0.15, P.pos.z, 2, 0xcfc4ae, 1.0, 0.7, 0.45);
    if (P.jumpBuf > 0 && P.state === 'slide') {
      // jump out of the slide
      P.jumpBuf = 0; P.stance = 'stand'; P.vel.y = JUMP;
      P.grounded = false; P.state = 'air'; sfx.jump();
    } else if ((t >= 1 || P.speed2d < 4) && P.state === 'slide') {
      // flow out: stand if room (else crouch), momentum kept
      tryStand(); P.state = P.grounded ? 'ground' : 'air';
    }
  } else if (P.state === 'feint') {
    // lateral juke: burst sideways, keep forward flow, stay glued to ground
    const fx = Math.sin(P.faceYaw), fz = Math.cos(P.faceYaw);
    const rx = -Math.cos(P.faceYaw), rz = Math.sin(P.faceYaw);
    const T = 0.32, t = Math.min(1, P.stateT / T);
    const desX = fx * 6 + rx * P.feintDir * 7.5;
    const desZ = fz * 6 + rz * P.feintDir * 7.5;
    const kf = 1 - Math.exp(-10 * dt);
    P.vel.x += (desX - P.vel.x) * kf;
    P.vel.z += (desZ - P.vel.z) * kf;
    physicsStep(dt);
    snapGround();
    if (t >= 1 && P.state === 'feint') { P.state = P.grounded ? 'ground' : 'air'; }
  } else if (P.state === 'wallrun') {
    // stick + drift along wall, reduced gravity: cannon pulls full gravity,
    // so pre-offset to net 12% (GRAV is negative — this adds lift)
    P.vel.y -= GRAV * 0.88 * dt;
    P.vel.y = Math.max(P.vel.y, -1.6);
    const along = new THREE.Vector3(-P.wallNormal.z, 0, P.wallNormal.x);
    if (along.dot(wish) < 0) along.negate();
    P.vel.x = along.x * 8.2 + P.wallNormal.x * -0.6;
    P.vel.z = along.z * 8.2 + P.wallNormal.z * -0.6;
    physicsStep(dt);
    snapGround();
    // end conditions
    const stillWall = forwardProbe(1.3, 1.35, P.faceYaw);
    if (P.stateT > 1.35 || P.grounded || !stillWall || il < 0.1) {
      P.state = P.grounded ? 'ground' : 'air';
    }
    if (P.jumpBuf > 0) { // wall jump!
      P.vel.copy(P.wallNormal).multiplyScalar(7.5); P.vel.y = 8.6;
      P.state = 'air'; P.jumpBuf = 0; P.wallSide = 0;
      sfx.jump(); popup('WALL-JUMP!');
    }
  } else {
    // normal ground/air — exponential-damp velocity (no ice-skating).
    // Sprint is committed: Desmond runs where he FACES and steers with
    // input (carve turns, never strafing). Walk/air follow wish directly.
    // Releasing input brakes HARD to a planted stop.
    let desX, desZ, rate;
    if (sprinting && P.grounded && il > 0.1) {
      desX = Math.sin(P.faceYaw) * RUN; desZ = Math.cos(P.faceYaw) * RUN;
      rate = 5.5;
    } else {
      desX = wish.x * maxSpeed; desZ = wish.z * maxSpeed;
      if (!P.grounded) rate = 2.4;
      else if (il < 0.1) rate = 14; // hard stop
      else rate = 11;
    }
    const k = 1 - Math.exp(-rate * dt);
    P.vel.x += (desX - P.vel.x) * k;
    P.vel.z += (desZ - P.vel.z) * k;
    // NOTE: gravity comes from cannon-es (world.step), never added by hand

    // jump-cut: release jump early for a short hop (AC-style control)
    if (!P.grounded && !keys['Space'] && !touchJumpHeld && P.vel.y > 4.5) P.vel.y = 4.5;

    // AUTO-VAULT: sprint into knee wall with headroom
    if (sprinting && P.grounded && wallKnee && !forwardProbe(SN.head, 1.0, P.faceYaw)) {
      const top = wallKnee.point.y;
      if (top - P.pos.y < 1.6) {
        P.state = 'vault'; P.stateT = 0;
        P.vaultFrom.copy(P.pos);
        P.vaultTo.copy(P.pos).addScaledVector(new THREE.Vector3(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw)), 2.6);
        P.vaultTo.y = top + 0.1;
        sfx.vault(); popup('VAULT!'); P.jumpBuf = 0;
      }
    }
    // AC FREE-RUN: sprinting at a wall flows into a climb (tall) or vault (low),
    // no jump press needed — just keep holding run toward the rooftops.
    if (P.state === 'ground' && sprinting && il > 0.3 && wallFwd) {
      if (!tryMantle(false)) grabWall();
    }
    P.dropCool = Math.max(0, P.dropCool - dt);
    // VaultDown (DPS port): hold S at a ledge edge to step into a controlled
    // drop with forward drift, instead of backing away from the edge
    if (P.grounded && P.state === 'ground' && (keys['KeyS'] || keys['ArrowDown']) && P.dropCool <= 0) {
      const dfx = Math.sin(P.faceYaw), dfz = Math.cos(P.faceYaw);
      tmpV.copy(P.pos); tmpV.y += 0.2; tmpV.x += dfx * 1.0; tmpV.z += dfz * 1.0;
      _dropRay.set(tmpV, V_DOWN); _dropRay.far = 1.5;
      if (!_dropRay.intersectObjects(collidables, false).length) {
        tmpV.copy(P.pos); tmpV.y += 0.2; tmpV.x += dfx * 1.8; tmpV.z += dfz * 1.8;
        _dropRay.far = 7.5;
        const land = _dropRay.intersectObjects(collidables, false)[0];
        if (land) {
          const drop = P.pos.y - land.point.y;
          if (drop > 1.5 && drop < 7) {
            P.vel.set(dfx * 3.5, 0.5, dfz * 3.5);
            P.grounded = false; P.state = 'air'; P.dropCool = 0.8; P.jumpBuf = 0;
            popup('DROP!'); sfx.jump();
          }
        }
      }
    }
    // DPS CheckBoundaries-lite: sprinting blindly at a deadly edge auto-brakes
    // to walk speed (press Space to leap anyway — intent wins)
    if (sprinting && P.grounded && P.state === 'ground' && P.jumpBuf <= 0) {
      const bfx = Math.sin(P.faceYaw), bfz = Math.cos(P.faceYaw);
      const brx = -bfz, brz = bfx;
      let misses = 0;
      for (const off of [-0.3, 0, 0.3]) {
        tmpV.copy(P.pos); tmpV.y += 0.5;
        tmpV.x += bfx * 1.1 + brx * off; tmpV.z += bfz * 1.1 + brz * off;
        _edgeRay.set(tmpV, V_DOWN); _edgeRay.far = 2.2;
        if (!_edgeRay.intersectObjects(collidables, false).length) misses++;
      }
      if (misses === 3) {
        tmpV.copy(P.pos); tmpV.y += 0.5; tmpV.x += bfx * 1.4; tmpV.z += bfz * 1.4;
        _edgeRay.far = 9;
        const deep = _edgeRay.intersectObjects(collidables, false)[0];
        const drop = deep ? P.pos.y - deep.point.y : Infinity;
        if (drop > 3) {
          const sp = Math.hypot(P.vel.x, P.vel.z);
          if (sp > 2.6) {
            const ns = Math.max(2.4, sp - 14 * dt);
            P.vel.x *= ns / sp; P.vel.z *= ns / sp;
          }
        }
      }
    }
    // manual vault/mantle
    if (vaultQueued) {
      vaultQueued = false;
      if (wallFwd) tryMantle(true);
    }
    // jump / mantle / climb / wallrun-enter
    if (P.jumpBuf > 0) {
      if (P.stance === 'prone') {
        tryStand(); P.jumpBuf = 0; // Space = get up first, jump next press
      } else {
        if (P.stance === 'crouch') P.stance = 'stand'; // spring up into the jump
        if (P.grounded || P.coyote > 0) {
          P.vel.y = JUMP; P.grounded = false; P.coyote = 0; P.jumpBuf = 0; P.state = 'air';
          sfx.jump();
        } else if (wallFwd && P.vel.y < 3) {
          // near the lip: quick mantle; fast lateral motion: wall-run; else grab & climb
          if (!tryMantle(false)) {
            const n = wallNormalFrom(wallFwd);
            const into = -(P.vel.x * n.x + P.vel.z * n.z);
            if (P.speed2d > 5.5 && into < 3) {
              P.state = 'wallrun'; P.stateT = 0;
              P.wallNormal.copy(n);
              P.wallSide = Math.sign(new THREE.Vector3(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw)).cross(P.wallNormal).y) || 1;
              P.jumpBuf = 0; sfx.wallrun(); popup('WALL-RUN!');
            } else if (!grabWall()) {
              P.jumpBuf = 0;
            }
          }
        } else if (!P.grounded && keys['Space']) {
          // hold space against wall = climb attempt (also each frame below)
        } else P.jumpBuf = 0;
      }
    }
    // hold-to-climb: pressing into wall while airborne & holding jump
    if (!P.grounded && (keys['Space']) && wallFwd && Math.abs(P.vel.y) < 6) {
      if (!tryMantle(false)) grabWall();
    }
    // ledge grab while rising through a jump or falling past a wall
    if (!P.grounded && P.hangCool <= 0 && P.vel.y < 6 && P.state !== 'wallrun') {
      tryGrabLedge();
    }
    // wall-follow: sprinting face-first into an unclimbable face for a while
    // steers along the tangent instead of face-planting forever (narrow
    // streets and tall towers stay traversable without stopping)
    P.blockedT = (wallFwd && P.grounded && P.state === 'ground' && il > 0.3 && P.speed2d < 1.0)
      ? P.blockedT + dt : 0;
    if (P.blockedT > 0.4 && P.state === 'ground') {
      const bn = wallNormalFrom(wallFwd);
      let tx = -bn.z, tz = bn.x;
      if (wish.x * tx + wish.z * tz < 0) { tx = -tx; tz = -tz; }
      wish.set(tx, 0, tz);
      if (!sprinting) wish.multiplyScalar(0.6);
    }

    // integrate in substeps (fast falls can't tunnel through thin roofs),
    // resolve the body against the world, then stick to the ground.
    P.vel.y = Math.max(P.vel.y, -20);
    // wall-seek: falling past faces drifts you in so ledges can be caught
    // (Assassin's magnet hands — without it falls drift away from walls)
    if (!P.grounded && P.vel.y < -1 && P.vel.y > -14 && P.state !== 'wallrun' && P.state !== 'hang') {
      const mfx = Math.sin(P.faceYaw), mfz = Math.cos(P.faceYaw);
      tmpV2.copy(P.pos); tmpV2.y += 1.2;
      rayFwd.set(tmpV2, tmpV3.set(mfx, 0, mfz)); rayFwd.far = 2.2;
      if (rayFwd.intersectObjects(collidables, false).length) {
        P.vel.x += mfx * 6 * dt;
        P.vel.z += mfz * 6 * dt;
      }
    }
    // leap-of-faith magnet: plummeting (or voluntary dive) near hay steers in
    if (!P.grounded && (P.vel.y < -9 || P.diveFlag) && haySpots.length) {
      let bd = Infinity, bh = null;
      for (const h of haySpots) {
        const d = Math.hypot(h.x - P.pos.x, h.z - P.pos.z);
        if (d < bd) { bd = d; bh = h; }
      }
      if (bh && bd < 7 && bd > 0.01) {
        P.vel.x += ((bh.x - P.pos.x) / bd) * 9 * dt;
        P.vel.z += ((bh.z - P.pos.z) / bd) * 9 * dt;
      }
    }
    const steps = P.vel.y < -10 ? 2 : 1;
    for (let st = 0; st < steps; st++) {
      const h = dt / steps;
      physicsStep(h); // cannon integrates, BVH slide-corrects
      snapGround();
    }
  }

  // exact ground stick against the real polygons (called per substep).
  // Scripted states keep their own state — only body+ground update.
  // (wallrun included: touchdown exits via its own end-conditions.)
  function snapGround() {
    const scripted = (P.state === 'slide' || P.state === 'feint' || P.state === 'wallrun');
    const g = groundProbe();
    if (g && P.vel.y <= 1.0) {
      const gy = g.point.y, gap = P.pos.y - gy;
      if (gap <= 0.08) {
        const fallSpeed = -P.vel.y;
        const drop = P.fallTop - gy;
        P.pos.y = gy; P.vel.y = 0;
        if (!P.grounded) {
          const onHay = g.object && g.object.material === hayMat;
          if (onHay && drop > 5) {
            // true leap of faith: big drop into the bale, softly caught —
            // white flash, slow motion, eagle screech, straw burst, squash
            popup('LEAP OF FAITH!'); sfx.dive(); setTimeout(() => sfx.ring(), 250);
            sfx.screech();
            flashT = 0.8; slowmoT = 0.9;
            haySquash = 1;
            spawnPuff(P.pos.x, gy + 0.8, P.pos.z, 16, 0xe8c34a, 1.6, 2.6, 0.9);
            P.vel.set(0, 0, 0); P.stamina = 1;
          } else if (onHay) {
            P.vel.multiplyScalar(0.3); sfx.land();
            haySquash = Math.max(haySquash, 0.5);
            spawnPuff(P.pos.x, gy + 0.6, P.pos.z, 6, 0xe8c34a, 1.0, 1.6, 0.6);
          } else if (fallSpeed > 14) { // hard landing -> roll (keeps flow)
            P.state = 'ground'; popup('ROLL!'); sfx.land();
            spawnPuff(P.pos.x, gy + 0.2, P.pos.z, Math.min(14, 4 + fallSpeed * 0.5), 0xcfc4ae, 1.6, 1.2, 0.7);
            P.vel.multiplyScalar(1.15);
          } else if (fallSpeed > 4) {
            sfx.land();
            spawnPuff(P.pos.x, gy + 0.15, P.pos.z, 5, 0xcfc4ae, 1.0, 0.9, 0.5);
          }
        }
        P.grounded = true; P.coyote = 0.14; P.diveFlag = false;
        if (!scripted) P.state = 'ground';
      } else if (P.grounded && gap <= 0.6) {
        // sticky: dip down small steps instead of bouncing off every tile lip
        P.pos.y = gy; P.vel.y = Math.min(P.vel.y, 0); P.coyote = 0.14;
      } else if (P.grounded) {
        // truly walked off an edge -> airborne
        P.grounded = false; if (!scripted) P.state = 'air'; P.coyote = 0.14;
      } else {
        P.coyote = Math.max(0, P.coyote - dt);
      }
    } else if (P.grounded && P.vel.y <= 1.0) {
      // ran past all geometry (gap / roof edge) -> airborne
      P.grounded = false; if (!scripted) P.state = 'air'; P.coyote = 0.14;
    } else if (!P.grounded) {
      P.coyote = Math.max(0, P.coyote - dt);
    }
  } // end snapGround()

  function tryMantle(force) {
    const fwd = new THREE.Vector3(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw));
    // sample wall top: step forward & probe down from above
    const probe = new THREE.Raycaster();
    probe.firstHitOnly = true;
    let found = null;
    // several forward offsets so narrow window sills register, not just walls
    for (const off of [0.55, 0.9, 1.25]) {
      for (let h = 2.6; h >= 0.4; h -= 0.3) {
        tmpV.copy(P.pos).addScaledVector(fwd, off); tmpV.y += h + 1.2;
        probe.set(tmpV, V_DOWN); probe.far = 3.4;
        const hits = probe.intersectObjects(collidables, false);
        if (hits.length) {
          const topY = hits[0].point.y;
          if (topY > P.pos.y - 0.4 && topY < P.pos.y + 2.6) { found = hits[0].point; break; }
        }
      }
      if (found) break;
    }
    if (found && !force && found.y - P.pos.y > 1.3) {
      // tall wall: don't teleport-fly — sustained climb handles it (or hang on the way)
      return false;
    }
    if (found || force) {
      const to = found ? found.clone() : P.pos.clone().addScaledVector(fwd, 1.6);
      to.y = (found ? found.y : P.pos.y + 1.0) + 0.05;
      if (!force) {
        // auto-mantles must land somewhere real: confirm footing under target
        tmpV.copy(to); tmpV.y += 1.5;
        probe.set(tmpV, V_DOWN); probe.far = 4.0;
        if (!probe.intersectObjects(collidables, false).length) return false;
      }
      P.state = force && !found ? 'vault' : 'climb';
      P.stateT = 0;
      if (P.state === 'climb') {
        P.climbFrom.copy(P.pos); P.climbTo.copy(to);
        P.climbTo.addScaledVector(fwd, 0.45);
        sfx.climb(); popup('CLIMB!');
      } else {
        P.vaultFrom.copy(P.pos); P.vaultTo.copy(to).addScaledVector(fwd, 1.2);
        sfx.vault(); popup('MANTLE!');
      }
      P.jumpBuf = 0; P.vel.set(0, 0, 0);
      return true;
    }
    return false;
  }

  function wallNormalFrom(hit) {
    const n = new THREE.Vector3();
    if (hit.face) n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    n.y = 0;
    if (n.lengthSq() < 0.01) n.set(-Math.sin(P.faceYaw), 0, -Math.cos(P.faceYaw));
    return n.normalize();
  }

  // grab a tall wall face and start sustained climbing (AC style).
  // A top in reach means a quick mantle; a sheer face with NO top in reach
  // is still grabbed at ground level and climbed until arms/stamina give out
  // (the per-frame top check mantles the moment a lip comes in reach) —
  // this is what makes sprint free-run work on real towers.
  function grabWall() {
    const fwd = new THREE.Vector3(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw));
    tmpV2.copy(P.pos); tmpV2.y += 1.2;
    rayFwd.set(tmpV2, fwd); rayFwd.far = 1.3;
    const wall = rayFwd.intersectObjects(collidables, false)[0];
    if (!wall) return false;
    const pr = new THREE.Raycaster();
    pr.firstHitOnly = true;
    let top = null;
    for (const off of [0.6, 1.0, 1.35]) {
      for (let h = 3.0; h >= 0.6; h -= 0.4) {
        tmpV.copy(P.pos).addScaledVector(fwd, off); tmpV.y += h + 1.2;
        pr.set(tmpV, V_DOWN); pr.far = 4.2;
        const hits = pr.intersectObjects(collidables, false);
        if (hits.length) {
          const ty = hits[0].point.y;
          if (ty > P.pos.y + 0.5 && ty < P.pos.y + 3.4) { top = hits[0].point; break; }
        }
      }
      if (top) break;
    }
    if (top && top.y - P.pos.y <= 1.3) return tryMantle(false); // near the lip: quick mantle
    // no top in reach (sheer tower face): grab low and climb anyway
    P.wallNormal.copy(wallNormalFrom(wall));
    P.faceYaw = Math.atan2(-P.wallNormal.x, -P.wallNormal.z); // face the stone
    P.pos.x = wall.point.x + P.wallNormal.x * 0.45;
    P.pos.z = wall.point.z + P.wallNormal.z * 0.45;
    P.vel.set(0, 0, 0); P.jumpBuf = 0;
    P.state = 'climbwall'; P.stateT = 0; P.diveFlag = false;
    P.stance = 'stand'; // climbing needs full reach
    P.climbBaseY = P.pos.y; // vertical climbs are capped — arms give out ~12 m up
    sfx.climb(); popup('CLIMB — W up · A/D across · Space off'); grabFade = 0.12;
    return true;
  }

  // catch a ledge while falling past it -> hang by the hands
  // (generous window: chest closes 1.3 m, top anywhere from waist to overhead)
  function tryGrabLedge() {
    const fwd = new THREE.Vector3(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw));
    const toward = P.vel.x * fwd.x + P.vel.z * fwd.z + wish.x * fwd.x * 2 + wish.z * fwd.z * 2;
    if (toward < 0.4 && !keys['Space'] && P.jumpBuf <= 0) return false;
    tmpV2.copy(P.pos); tmpV2.y += 1.2;
    rayFwd.set(tmpV2, fwd); rayFwd.far = 1.3;
    const wall = rayFwd.intersectObjects(collidables, false)[0];
    if (!wall) return false;
    tmpV2.copy(P.pos); tmpV2.y += 2.3;
    rayFwd.set(tmpV2, fwd); rayFwd.far = 1.3;
    if (rayFwd.intersectObjects(collidables, false).length) return false; // head blocked
    const pr = new THREE.Raycaster();
    pr.firstHitOnly = true;
    let top = null;
    for (const off of [0.55, 0.9, 1.2]) {
      tmpV.copy(P.pos).addScaledVector(fwd, off); tmpV.y += 2.4;
      pr.set(tmpV, V_DOWN); pr.far = 3.6;
      const hits = pr.intersectObjects(collidables, false);
      if (hits.length) {
        const ty = hits[0].point.y;
        if (ty >= P.pos.y + 0.7 && ty <= P.pos.y + 2.4) { top = hits[0].point; break; }
      }
    }
    if (!top) return false;
    P.state = 'hang'; P.stateT = 0; P.diveFlag = false;
    P.stance = 'stand'; // hanging needs full reach
    P.hangNormal.copy(wallNormalFrom(wall));
    P.hangTop.copy(top);
    P.pos.x = top.x - fwd.x * 0.5; P.pos.z = top.z - fwd.z * 0.5;
    P.pos.y = top.y - 1.65; // hands plant right on the lip
    P.vel.set(0, 0, 0); P.jumpBuf = 0;
    sfx.grab(); grabFade = 0.12;
    spawnPuff(P.pos.x, P.pos.y + 1.2, P.pos.z, 3, 0xcfc4ae, 0.7, 0.4, 0.4);
    if (P.hintHangCool <= 0) {
      popup('LEDGE — W pull up · S drop · A/D shimmy');
      P.hintHangCool = 8;
    }
    return true;
  }

  // is there still ledge + wall at these feet coordinates? (shimmy validation)
  function hangHolds(feetPos) {
    const fwd = new THREE.Vector3(Math.sin(P.faceYaw), 0, Math.cos(P.faceYaw));
    const chest = new THREE.Vector3().copy(feetPos); chest.y += 1.2;
    const r1 = new THREE.Raycaster(chest, fwd); r1.far = 1.1;
    if (!r1.intersectObjects(collidables, false).length) return false;
    const above = new THREE.Vector3().copy(feetPos).addScaledVector(fwd, 0.85); above.y += 2.4;
    const r2 = new THREE.Raycaster(above, V_DOWN); r2.far = 3.4;
    const hits = r2.intersectObjects(collidables, false);
    if (!hits.length) return false;
    const ty = hits[0].point.y;
    return (ty > feetPos.y + 0.9 && ty < feetPos.y + 2.2);
  }

  function dropFromHang() {
    P.state = 'air'; P.stateT = 0;
    P.vel.copy(P.hangNormal).multiplyScalar(1.5); P.vel.y = -1;
    P.hangCool = 0.6; P.jumpBuf = 0;
  }

  P.speed2d = Math.hypot(P.vel.x, P.vel.z);
  // fell out of world
  if (P.pos.y < -30) respawn();
}

function fmtTime(s) {
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

/* ---------------- Desmond animation (procedural parkour) ---------------- */
function animateDesmond(dt, t) {
  const d = desmondGLB && !desmond.visible ? null : desmond;
  if (desmondGLB) {
    // real Desmond: holder follows the player, .glb animations do the acting.
    // (Verified against renders + exporter math: the .blend faces -Y, which
    // the glTF +Y-up swizzle maps to +Z — three.js forward. No offset.)
    desmondHolder.position.copy(P.pos);
    desmondHolder.rotation.y = P.faceYaw;
    // DPS feet-IK lite: twin rays under the soles tilt the pelvis and lift
    // the body onto uneven stone (visual only — physics uses P.pos)
    if (P.grounded && P.state === 'ground') {
      const frx = -Math.cos(P.faceYaw), frz = Math.sin(P.faceYaw);
      let hL = P.pos.y, hR = P.pos.y;
      tmpV.set(P.pos.x + frx * 0.28, P.pos.y + 0.9, P.pos.z + frz * 0.28);
      _feetRay.set(tmpV, V_DOWN); _feetRay.far = 2.2;
      const hr = _feetRay.intersectObjects(collidables, false)[0];
      if (hr) hR = hr.point.y;
      tmpV.set(P.pos.x - frx * 0.28, P.pos.y + 0.9, P.pos.z - frz * 0.28);
      _feetRay.set(tmpV, V_DOWN);
      const hl = _feetRay.intersectObjects(collidables, false)[0];
      if (hl) hL = hl.point.y;
      const tRoll = Math.max(-0.18, Math.min(0.18, (hL - hR) * 0.6));
      const tLift = Math.max(0, Math.min(0.22, Math.max(hL, hR) - P.pos.y));
      const fk = Math.min(1, dt * 8);
      P.feetRoll += (tRoll - P.feetRoll) * fk;
      P.feetLift += (tLift - P.feetLift) * fk;
    } else {
      P.feetRoll *= 0.9; P.feetLift *= 0.9;
    }
    desmondGLB.position.y = desmondFeetY + P.feetLift;
    if (P.state === 'hang') {
      desmondHolder.rotation.z = Math.sin(t * 1.8) * 0.05; // dangle sway
      desmondHolder.rotation.x = 0;
    } else if (P.state === 'feint') {
      desmondHolder.rotation.z = -P.feintDir * 0.45; // lean into the juke
      desmondHolder.rotation.x = 0;
    } else if (!P.grounded && (P.vel.y < -9 || P.diveFlag)) {
      desmondHolder.rotation.x = 0.35; // headfirst dive lean
      desmondHolder.rotation.z = 0;
    } else {
      // assassin stride: bank into lateral motion, lean forward with speed
      const vLat = P.vel.x * -Math.cos(P.faceYaw) + P.vel.z * Math.sin(P.faceYaw);
      const bank = Math.max(-0.3, Math.min(0.3, vLat * 0.05));
      const lean = 0.04 + 0.1 * Math.min(1, P.speed2d / 8);
      desmondHolder.rotation.x += (lean - desmondHolder.rotation.x) * Math.min(1, dt * 6);
      const zt = ((P.grounded && P.state === 'ground') ? P.feetRoll : 0) + bank;
      desmondHolder.rotation.z += (zt - desmondHolder.rotation.z) * Math.min(1, dt * 8);
    }
    desmondTickMixer(dt);
  }
  if (!d) return;
  d.position.copy(P.pos);
  d.rotation.y = P.faceYaw;

  const running = P.grounded && P.speed2d > 0.8;
  if (running) P.runPhase += dt * (4 + P.speed2d * 1.35);
  const sw = Math.sin(P.runPhase), sw2 = Math.sin(P.runPhase + Math.PI);

  if (P.state === 'wallrun') {
    d.rotation.z = 0.38 * P.wallSide;
    rig['hipL'].rotation.x = -0.7; rig['hipR'].rotation.x = 0.5;
    rig['kneeL'].rotation.x = 0.9; rig['kneeR'].rotation.x = 0.3;
    rig['shoulderL'].rotation.x = -1.2; rig['shoulderR'].rotation.x = 0.8;
    rig['shoulderL'].rotation.z = 0.9 * P.wallSide; rig['shoulderR'].rotation.z = 0.9 * P.wallSide;
    rig.torso.rotation.x = 0.15;
  } else if (P.state === 'climb') {
    d.rotation.z = 0;
    const c = Math.sin(P.stateT * 14);
    rig['shoulderL'].rotation.x = -2.4 + c * 0.5; rig['shoulderR'].rotation.x = -2.4 - c * 0.5;
    rig['elbowL'].rotation.x = -0.5; rig['elbowR'].rotation.x = -0.5;
    rig['hipL'].rotation.x = -1.1 + c * 0.4; rig['hipR'].rotation.x = -1.1 - c * 0.4;
    rig['kneeL'].rotation.x = 1.4; rig['kneeR'].rotation.x = 1.4;
    rig.torso.rotation.x = -0.25;
  } else if (P.state === 'vault') {
    d.rotation.z = 0;
    const t2 = P.stateT / 0.45;
    rig['hipL'].rotation.x = -1.4 + t2 * 1.8; rig['hipR'].rotation.x = -1.2 + t2 * 1.6;
    rig['kneeL'].rotation.x = 1.6 * (1 - t2); rig['kneeR'].rotation.x = 1.6 * (1 - t2);
    rig['shoulderL'].rotation.x = 0.8 - t2; rig['shoulderR'].rotation.x = 0.8 - t2;
    rig['elbowL'].rotation.x = -0.4; rig['elbowR'].rotation.x = -0.4;
    rig.torso.rotation.x = 0.35;
  } else if (!P.grounded) {
    d.rotation.z = 0;
    const rising = P.vel.y > 1;
    rig['hipL'].rotation.x = rising ? -0.9 : -0.35; rig['hipR'].rotation.x = rising ? 0.55 : -0.9;
    rig['kneeL'].rotation.x = rising ? 1.5 : 0.5; rig['kneeR'].rotation.x = rising ? 0.6 : 1.6;
    rig['shoulderL'].rotation.x = rising ? -2.2 : -0.7; rig['shoulderR'].rotation.x = rising ? -2.0 : -1.1;
    rig['elbowL'].rotation.x = -0.7; rig['elbowR'].rotation.x = -0.7;
    rig.torso.rotation.x = rising ? -0.12 : 0.18;
  } else if (running) {
    d.rotation.z = Math.sin(P.runPhase) * 0.03;
    rig['hipL'].rotation.x = sw * 0.95; rig['hipR'].rotation.x = sw2 * 0.95;
    rig['kneeL'].rotation.x = Math.max(0, -sw2 * 1.3); rig['kneeR'].rotation.x = Math.max(0, -sw * 1.3);
    rig['shoulderL'].rotation.x = sw2 * 0.85; rig['shoulderR'].rotation.x = sw * 0.85;
    rig['elbowL'].rotation.x = -0.55 - Math.max(0, sw2) * 0.4;
    rig['elbowR'].rotation.x = -0.55 - Math.max(0, sw) * 0.4;
    rig.torso.rotation.x = 0.12 + Math.min(0.15, P.speed2d * 0.012);
    rig.torso.position.y = 0.32 + Math.abs(Math.cos(P.runPhase)) * 0.045;
  } else {
    d.rotation.z = 0; // idle breath
    const b = Math.sin(t * 2) * 0.05;
    rig['shoulderL'].rotation.x = b; rig['shoulderR'].rotation.x = -b;
    rig['hipL'].rotation.x *= 0.9; rig['hipR'].rotation.x *= 0.9;
    rig['kneeL'].rotation.x *= 0.9; rig['kneeR'].rotation.x *= 0.9;
    rig.torso.rotation.x = 0.02 + b * 0.3;
    rig.torso.position.y = 0.32 + b * 0.2;
  }
  // blob shadow follows ground
  const g = groundProbe();
  if (g) {
    rig.blob.visible = true;
    rig.blob.position.y = (g.point.y - P.pos.y) + 0.03;
    const h = Math.max(0, P.pos.y - g.point.y);
    rig.blob.material.opacity = Math.max(0, 0.3 - h * 0.03);
    const s = Math.max(0.4, 1 - h * 0.06);
    rig.blob.scale.set(s, s, 1);
  } else rig.blob.visible = false;
}

/* ---------------- camera ---------------- */
const camRay = new THREE.Raycaster();
camRay.firstHitOnly = true;
function updateCamera(dt) {
  const SN = stanceNums();
  const head = tmpV.copy(P.pos); head.y += SN.camHead;
  const off = tmpV2.set(
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  ).multiplyScalar(camDist);
  // shoulder offset
  const side = tmpV3.set(-Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(0.55);
  const want = head.clone().add(off).add(side);
  // keep camera out of geometry (cheap solids only)
  const dir = want.clone().sub(head);
  const len = dir.length(); dir.normalize();
  camRay.set(head, dir); camRay.far = len;
  const hit = camRay.intersectObjects(collidables, false)[0];
  const final = hit ? head.clone().addScaledVector(dir, Math.max(0.6, hit.distance - 0.35)) : want;
  camera.position.lerp(final, 1 - Math.pow(0.0001, dt));
  const look = new THREE.Vector3(P.pos.x, P.pos.y + stanceNums().camLook, P.pos.z);
  camera.lookAt(look);
  // sun follows player for tight shadows
  sun.position.set(P.pos.x + 60, P.pos.y + 90, P.pos.z + 30);
  sun.target.position.copy(P.pos);
  sun.target.updateMatrixWorld();
}

/* ---------------- HUD (free-run: timer + speed + stamina) ---------------- */
function updateHUD() {
  timerPill.textContent = `⏱ ${fmtTime(P.elapsed)}`;
  speedPill.textContent = `≫ ${P.speed2d.toFixed(1)} m/s`;
  staminaFill.style.width = `${Math.round(P.stamina * 100)}%`;
}

/* ---------------- main loop ---------------- */
const flashEl = document.getElementById('flash');
let flashT = 0, slowmoT = 0;
function loop() {
  requestAnimationFrame(loop);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  let dt = Math.min(rawDt, 0.033);
  if (slowmoT > 0) { slowmoT -= rawDt; dt *= 0.35; } // leap-of-faith slow motion
  const t = clock.elapsedTime;
  if (started) {
    P.elapsed += dt;
    updatePlayer(dt);
  }
  animateDesmond(dt, t);
  updateCamera(dt);
  if (started) updateHUD();
  // living surroundings (real-time even in slow motion)
  updateFlags(t);
  updateBirds(t, rawDt);
  updatePuffs(rawDt);
  if (haySquash > 0 && hayMesh) {
    haySquash = Math.max(0, haySquash - rawDt * 2.2);
    const s = Math.sin(Math.min(1, haySquash) * Math.PI);
    hayMesh.scale.set(1 + 0.22 * s, 1 - 0.32 * s, 1 + 0.22 * s);
    if (haySquash <= 0) hayMesh.scale.set(1, 1, 1);
  }
  if (flashT > 0) {
    flashT -= rawDt;
    const k = 1 - Math.max(0, flashT) / 0.8;
    flashEl.style.opacity = (Math.sin(k * Math.PI) * 0.85).toFixed(2);
    if (flashT <= 0) flashEl.style.opacity = 0;
  }
  // dive FOV kick
  const wantFov = (!P.grounded && P.vel.y < -9) ? 70 : 62;
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, rawDt * 3);
    camera.updateProjectionMatrix();
  }
  updateWind();
  renderer.render(scene, camera);
}

/* ---------------- boot ---------------- */
async function boot() {
  loadText.textContent = 'Loading Monteriggioni…';
  const ok = await loadCity((f) => { loadFill.style.width = `${Math.round(f * 90)}%`; });
  loadFill.style.width = '92%';
  loadText.textContent = ok ? 'Building parkour course…' : 'City file missing — building training rooftops…';
  await new Promise((r) => setTimeout(r, 30));
  if (!ok) buildFallbackCity();
  loadText.textContent = 'Mapping every stone (exact collision)…';
  await buildCityColliders((f) => { loadFill.style.width = `${92 + Math.round(f * 6)}%`; });
  loadText.textContent = 'Placing Desmond on the viewpoint…';
  buildCourse();
  P.pos.copy(spawnPoint);
  P.fallTop = spawnPoint.y;
  // cannon-es dynamics: player body + static twins (street plane is inside)
  initPhysics(spawnPoint.x, spawnPoint.y, spawnPoint.z);
  for (const h of haySpots) addHayBody(h.x, 0.5, h.z);
  console.log('[physics] cannon-es world live: player 75 kg, gravity -24, fixed 1/60');
  const cc = cityBox.getCenter(new THREE.Vector3());
  P.faceYaw = Math.atan2(cc.x - P.pos.x, cc.z - P.pos.z);
  yaw = P.faceYaw; // camera sits behind Desmond, overlooking the city
  pitch = -0.3;
  camera.position.set(P.pos.x - Math.sin(yaw) * camDist, P.pos.y + 3, P.pos.z - Math.cos(yaw) * camDist);
  loadFill.style.width = '100%';
  loadingEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  if (isTouch) touchEl.classList.remove('hidden');
  loop();
  // idle camera drift behind menu
  if (!started) toast('Click START RUNNING, then click the world to lock the mouse');
}

playBtn.addEventListener('click', () => {
  menuEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  started = true;
  P.startTime = performance.now(); P.elapsed = 0;
  beep(523, 0.12, 'sine', 0.15); setTimeout(() => beep(784, 0.18, 'sine', 0.15), 120);
  startWind();
  hintBar.innerHTML = `Walk with <b>WASD</b> · hold <b>Shift</b> to sprint · run at walls to climb`;
  if (!isTouch) canvas.requestPointerLock?.();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

boot();
