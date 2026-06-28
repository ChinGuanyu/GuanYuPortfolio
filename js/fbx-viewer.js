// js/fbx-viewer.js
// Minimal Three.js FBX viewer for uploaded models.
// Called by editor.js after retrieving a file ArrayBuffer from IndexedDB.

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export async function initFBXViewer(canvas, arrayBuffer) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const w = canvas.clientWidth || canvas.offsetWidth || 300;
  const h = canvas.clientHeight || canvas.offsetHeight || 188;
  renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
  camera.position.set(0, 1, 4);

  // Match the site's 3-point studio lighting
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 5, 6);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xC97B4A, 1.2);
  rim.position.set(-5, -2, -4);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0x5B7A86, 0.4));

  // Load the FBX from the provided ArrayBuffer
  let model;
  try {
    const loader = new FBXLoader();
    model = await new Promise((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    // Auto-center and uniform scale to fit the view
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2.5 / maxDim;
    model.scale.setScalar(scale);
    model.position.sub(center.multiplyScalar(scale));

    scene.add(model);
  } catch (err) {
    console.warn('FBX load failed, showing placeholder.', err);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xC97B4A, metalness: 0.3, roughness: 0.5, flatShading: true,
    });
    model = new THREE.Mesh(geo, mat);
    scene.add(model);
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.enablePan = false;
  controls.minDistance = 1;
  controls.maxDistance = 12;

  // Pause auto-rotate while user is interacting
  canvas.addEventListener('pointerenter', () => { controls.autoRotate = false; });
  canvas.addEventListener('pointerleave', () => { controls.autoRotate = true; });

  let rafId;
  function animate() {
    rafId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Resize observer keeps the canvas sharp if the card changes size
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const nw = canvas.clientWidth;
      const nh = canvas.clientHeight;
      renderer.setSize(nw, nh, false);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(canvas);
  }

  // Return a cleanup function for when a card is deleted
  return () => {
    cancelAnimationFrame(rafId);
    renderer.dispose();
  };
}
