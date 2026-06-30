// js/intro-scene.js
//
// Scroll-driven 3D intro.
// -----------------------
// Core idea: scroll position (0 -> 1 across the whole page) drives the
// object's rotation and the camera's distance (zoom). Nothing here is tied
// to a specific 3D model — swap PLACEHOLDER for a real .glb via loadModel()
// whenever you have one ready, the scroll-binding logic doesn't change.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- Config ----------
// Edit this to point at your real model once you have one in /assets/models.
// Leave MODEL_URL as null to keep using the placeholder shape.
const MODEL_URL = null; // e.g. 'assets/models/hero-object.glb'

const NUM_BEATS = document.querySelectorAll('.beat').length;

// ---------- Renderer / Scene / Camera ----------
const canvas = document.getElementById('intro-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,           // transparent background -> blends with page bg
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 6);

// ---------- Lighting ----------
// Studio-style 3-point lighting so the object reads with real form/shadow,
// matching the "sculptor's viewport" direction rather than flat toon shading.
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(4, 5, 6);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xC97B4A, 1.4); // clay-tinted rim
rimLight.position.set(-5, -2, -4);
scene.add(rimLight);

const ambient = new THREE.AmbientLight(0x5B7A86, 0.35); // cool fill
scene.add(ambient);

// ---------- Object (placeholder until a real model is loaded) ----------
let heroObject;

function buildPlaceholder() {
  // An icosahedron reads as "raw geometry" -- fits the copy ("starts as
  // raw geometry") on beat 1, and looks intentional rather than a generic
  // cube/sphere placeholder.
  const geometry = new THREE.IcosahedronGeometry(1.6, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xC97B4A,
    metalness: 0.35,
    roughness: 0.45,
    flatShading: true,
  });
  return new THREE.Mesh(geometry, material);
}

function loadModel(url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const obj = gltf.scene;
        // Auto-center and scale to a consistent on-screen size regardless
        // of the model's original units.
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        obj.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2.2 / maxDim;
        obj.scale.setScalar(scale);
        resolve(obj);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

async function init() {
  if (MODEL_URL) {
    try {
      heroObject = await loadModel(MODEL_URL);
    } catch (e) {
      console.warn('Model failed to load, falling back to placeholder.', e);
      heroObject = buildPlaceholder();
    }
  } else {
    heroObject = buildPlaceholder();
  }
  scene.add(heroObject);
  animate();
}

// ---------- Scroll binding ----------
// scrollProgress: 0 at top of page, 1 at bottom.
let scrollProgress = 0;
let targetRotationY = 0;
let targetCameraZ = 6;

function updateScrollProgress() {
  const track = document.getElementById('scroll-track');
  const trackHeight = track.offsetHeight - window.innerHeight;
  const scrolled = window.scrollY;
  scrollProgress = trackHeight > 0
    ? Math.min(Math.max(scrolled / trackHeight, 0), 1)
    : 0;

  // Map scroll -> rotation: a couple of full turns across the whole intro,
  // so the object visibly "performs" as you scroll rather than barely moving.
  targetRotationY = scrollProgress * Math.PI * 2.4;

  // Map scroll -> camera distance: starts further back (6), ends close (3.2)
  // i.e. "zooming in" as the user scrolls down, per the brief.
  targetCameraZ = 6 - scrollProgress * 2.8;

  // Progress rail UI
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.height = `${scrollProgress * 100}%`;

  // Reveal Enter button once we're effectively at the bottom
  const btn = document.getElementById('enter-btn');
  if (scrollProgress > 0.97) {
    btn.classList.add('is-ready');
    btn.disabled = false;
  } else {
    btn.classList.remove('is-ready');
    btn.disabled = true;
  }
}

window.addEventListener('scroll', updateScrollProgress, { passive: true });
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- Render loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (heroObject) {
    // Smoothly ease current rotation/zoom toward scroll-driven targets
    // (lerp) rather than snapping -- makes scrubbing feel fluid even on
    // a fast scroll wheel or trackpad flick.
    heroObject.rotation.y += (targetRotationY - heroObject.rotation.y) * 0.08;
    heroObject.rotation.x = Math.sin(targetRotationY * 0.4) * 0.15;

    // Gentle idle bob so the object never looks frozen, independent of scroll
    heroObject.position.y = Math.sin(clock.elapsedTime * 0.6) * 0.08;
  }

  camera.position.z += (targetCameraZ - camera.position.z) * 0.08;

  renderer.render(scene, camera);
}

// ---------- Enter button ----------
document.getElementById('enter-btn').addEventListener('click', (e) => {
  if (e.currentTarget.disabled) return;
  window.location.href = 'hub/index.html';
});

init();
updateScrollProgress();
