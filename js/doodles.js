// js/doodles.js
// Floating doodle background — imported by editor.js so it runs on every page.
// Hand-drawn style shapes drift slowly behind the content on their own paths
// (wrapper animates X, the svg inside animates Y + sway → gentle wandering).

const SHAPES = [
  // wireframe cube
  `<svg viewBox="0 0 100 100"><path d="M20 35 L50 20 L80 35 L50 50 Z"/><path d="M20 35 V65 L50 80 V50"/><path d="M80 35 V65 L50 80"/></svg>`,
  // five-point star
  `<svg viewBox="0 0 100 100"><path d="M50 12 L59 38 L87 39 L65 56 L73 83 L50 67 L27 83 L35 56 L13 39 L41 38 Z"/></svg>`,
  // spiral
  `<svg viewBox="0 0 100 100"><path d="M50 50 q12 -16 -4 -20 q-20 -5 -22 18 q-2 28 30 28 q38 0 36 -40"/></svg>`,
  // squiggle wave
  `<svg viewBox="0 0 120 40"><path d="M6 24 q12 -18 24 0 q12 18 24 0 q12 -18 24 0 q12 18 24 0"/></svg>`,
  // smiley
  `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="34"/><path d="M38 41 v3 M62 41 v3"/><path d="M36 60 q14 14 28 0"/></svg>`,
  // planet with ring
  `<svg viewBox="0 0 120 100"><circle cx="60" cy="50" r="24"/><ellipse cx="60" cy="50" rx="46" ry="14" transform="rotate(-18 60 50)"/></svg>`,
  // curvy arrow
  `<svg viewBox="0 0 120 60"><path d="M8 46 q50 -34 96 -14"/><path d="M88 22 l16 10 l-19 8"/></svg>`,
  // sparkle
  `<svg viewBox="0 0 60 60"><path d="M30 8 V52 M8 30 H52"/><path d="M17 17 L43 43 M43 17 L17 43" opacity=".45"/></svg>`,
  // heart
  `<svg viewBox="0 0 100 90"><path d="M50 74 C20 54 12 34 26 22 q14 -10 24 6 q10 -16 24 -6 c14 12 6 32 -24 52 Z"/></svg>`,
  // lightbulb
  `<svg viewBox="0 0 80 100"><circle cx="40" cy="38" r="20"/><path d="M32 62 h16 M34 70 h12"/><path d="M40 8 v-2 M14 38 h-4 M70 38 h-4 M20 18 l-4 -4 M64 18 l4 -4"/></svg>`,
  // triangle
  `<svg viewBox="0 0 100 90"><path d="M50 12 L88 78 L12 78 Z"/></svg>`,
  // crescent moon
  `<svg viewBox="0 0 100 100"><path d="M62 14 a38 38 0 1 0 24 68 a30 30 0 1 1 -24 -68 Z"/></svg>`,
];

// Scattered mostly toward the edges; the few mid-page ones are small + faint
const SPOTS = [
  { x: 5,  y: 12, s: 64 },
  { x: 88, y: 9,  s: 54 },
  { x: 15, y: 38, s: 44 },
  { x: 92, y: 42, s: 60 },
  { x: 4,  y: 70, s: 56 },
  { x: 85, y: 74, s: 66 },
  { x: 28, y: 88, s: 48 },
  { x: 62, y: 91, s: 52 },
  { x: 45, y: 5,  s: 40 },
  { x: 71, y: 24, s: 36 },
  { x: 34, y: 60, s: 32 },
  { x: 56, y: 46, s: 28 },
];

const CSS_TEXT = `
.doodle-field {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}
.doodle {
  position: absolute;
  width: var(--size, 56px);
  opacity: var(--o, 0.4);
  animation: doodleX var(--dx, 26s) ease-in-out var(--d, 0s) infinite alternate;
}
.doodle svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  animation:
    doodleY var(--dy, 18s) ease-in-out var(--d, 0s) infinite alternate,
    doodleSway var(--dr, 20s) ease-in-out var(--d, 0s) infinite alternate;
}
.doodle svg * {
  fill: none;
  stroke: rgba(154, 151, 143, 0.75);   /* ink-dim tone — readable on graphite */
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.doodle--clay svg * { stroke: rgba(201, 123, 74, 0.75); }
.doodle--wire svg * { stroke: rgba(91, 122, 134, 0.85); }

/* Wandering path: X on the wrapper, Y + sway on the svg (separate transforms) */
@keyframes doodleX    { from { translate: calc(var(--ax, 40px) * -1) 0; } to { translate: var(--ax, 40px) 0; } }
@keyframes doodleY    { from { translate: 0 calc(var(--ay, 30px) * -1); } to { translate: 0 var(--ay, 30px); } }
@keyframes doodleSway { from { rotate: -9deg; } to { rotate: 9deg; } }

@media (max-width: 680px) {
  .doodle { width: calc(var(--size, 56px) * 0.75); }
  .doodle:nth-child(n + 8) { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .doodle, .doodle svg { animation: none; }
}
`;

const rand = (a, b) => a + Math.random() * (b - a);

function init() {
  if (document.querySelector('.doodle-field')) return;

  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);

  const field = document.createElement('div');
  field.className = 'doodle-field';
  field.setAttribute('aria-hidden', 'true');

  const shapes = [...SHAPES].sort(() => Math.random() - 0.5);
  SPOTS.forEach((spot, i) => {
    const wrap = document.createElement('span');
    wrap.className = 'doodle' + ['', ' doodle--clay', ' doodle--wire'][i % 3];
    wrap.style.left = spot.x + '%';
    wrap.style.top  = spot.y + '%';
    wrap.style.setProperty('--size', spot.s + 'px');
    wrap.style.setProperty('--o',  (spot.s >= 44 ? rand(0.45, 0.62) : rand(0.28, 0.4)).toFixed(2));
    wrap.style.setProperty('--dx', rand(20, 36).toFixed(1) + 's');
    wrap.style.setProperty('--dy', rand(13, 24).toFixed(1) + 's');
    wrap.style.setProperty('--dr', rand(14, 26).toFixed(1) + 's');
    wrap.style.setProperty('--ax', rand(24, 64).toFixed(0) + 'px');
    wrap.style.setProperty('--ay', rand(18, 48).toFixed(0) + 'px');
    // negative delay = start mid-drift so nothing moves in sync
    wrap.style.setProperty('--d', (-rand(0, 30)).toFixed(1) + 's');
    wrap.innerHTML = shapes[i % shapes.length];
    field.appendChild(wrap);
  });

  document.body.appendChild(field);
}

init();
