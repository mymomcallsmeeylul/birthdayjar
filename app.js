import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const STORAGE_KEY = "birthday-jar-notes";
const MAX_PAPERS_SHOWN = 80;
const PILE_STEP = 3;   // % of jar height per note
const PILE_MAX = 88;   // % cap so the jar never looks completely full

const CRUMPLE_MS = 1300; // paper balls up
const TUMBLE_MS = 220;   // a beat with the ball in the air
const FLY_MS = 950;      // ball travels into the jar

const $ = (id) => document.getElementById(id);
const jar = $("jar");
const pile = $("pile");
const papersEl = $("papers");
const overlay = $("overlay");
const paper = $("paper");
const textarea = $("noteText");
const sendBtn = $("sendBtn");
const backBtn = $("backBtn");
const createBtn = $("createBtn");

let sending = false;

// ---------- storage (per-browser for now) ----------
function loadNotes() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveNotes(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

let notes = loadNotes();

// ---------- jar rendering ----------
// Small seeded random so each note keeps the same spot in the jar.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pileHeight(count) {
  return Math.min(PILE_MAX, count * PILE_STEP);
}

function renderJar(animateNewest = false) {
  const count = notes.length;
  pile.style.height = pileHeight(count) + "%";

  papersEl.innerHTML = "";
  const shown = notes.slice(-MAX_PAPERS_SHOWN);
  const top = pileHeight(count);

  shown.forEach((note, i) => {
    const rnd = seeded(note.seed || i + 1);
    const el = document.createElement("div");
    el.className = "mini-paper";
    const left = 10 + rnd() * 52;
    const bottom = 2 + rnd() * Math.max(top - 12, 2);
    const rot = (rnd() * 40 - 20).toFixed(1) + "deg";
    el.style.left = left + "%";
    el.style.bottom = bottom + "%";
    el.style.setProperty("--r", rot);
    el.style.transform = `rotate(${rot})`;
    el.style.zIndex = i;
    if (!(animateNewest && i === shown.length - 1)) el.style.animation = "none";
    papersEl.appendChild(el);
  });
}

// ---------- note editor ----------
function openEditor() {
  textarea.value = "";
  sendBtn.disabled = true;
  overlay.hidden = false;
  paper.style.animation = "none";
  void paper.offsetWidth; // restart the entrance animation
  paper.style.animation = "";
  setTimeout(() => textarea.focus(), 50);
}

function closeEditor() {
  overlay.hidden = true;
  overlay.classList.remove("sending");
  paper.style.visibility = "";
}

textarea.addEventListener("input", () => {
  sendBtn.disabled = textarea.value.trim().length === 0 || sending;
});

createBtn.addEventListener("click", openEditor);
backBtn.addEventListener("click", () => {
  if (!sending) closeEditor();
});

sendBtn.addEventListener("click", async () => {
  const text = textarea.value.trim();
  if (!text || sending) return;

  sending = true;
  sendBtn.disabled = true;
  backBtn.disabled = true;
  overlay.classList.add("sending");

  const note = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    text,
    seed: Math.floor(Math.random() * 1e9) + 1,
    createdAt: new Date().toISOString(),
  };

  await crumpleAndFly(text, paper, jar);

  notes.push(note);
  saveNotes(notes);
  renderJar(true);

  textarea.value = "";
  backBtn.disabled = false;
  sending = false;
  closeEditor();
});

// ---------- the paper, drawn as a texture ----------
function paperTexture(text, W, H) {
  const s = 2;
  const c = document.createElement("canvas");
  c.width = W * s;
  c.height = H * s;
  const g = c.getContext("2d");

  g.fillStyle = "#fdfbf4";
  g.fillRect(0, 0, c.width, c.height);

  g.strokeStyle = "#d9e3ec";
  g.lineWidth = s;
  for (let y = 31; y < H; y += 32) {
    g.beginPath();
    g.moveTo(0, y * s);
    g.lineTo(W * s, y * s);
    g.stroke();
  }
  g.strokeStyle = "#e9a3a3";
  g.beginPath();
  g.moveTo(40 * s, 0);
  g.lineTo(40 * s, H * s);
  g.stroke();

  g.fillStyle = "#2f2a24";
  g.font = `${24 * s}px Caveat, "Segoe Script", cursive`;
  const maxW = (W - 66) * s;
  const words = text.split(/\s+/);
  let line = "";
  let row = 0;
  const flush = () => {
    g.fillText(line, 52 * s, (56 + 32 * row) * s);
    row++;
    line = "";
  };
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (line && g.measureText(test).width > maxW) {
      flush();
      line = w;
    } else {
      line = test;
    }
  }
  if (line) flush();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// fine paper grain for the bump map
function grainTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const d = g.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 225 + Math.random() * 30;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// smooth-ish 3D noise from sines, roughly -1..1
function wrinkle(x, y, z) {
  return (
    Math.sin(x * 3.1 + Math.sin(y * 2.3 + z * 1.7) * 1.5) *
    Math.sin(y * 2.7 + Math.cos(z * 3.3 + x * 1.9)) *
    Math.sin(z * 2.9 + Math.sin(x * 1.3 + y * 2.1))
  );
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------- crumple into a ball, then fly into the jar ----------
async function crumpleAndFly(text, paperEl, jarEl) {
  const pr = paperEl.getBoundingClientRect();
  const jr = jarEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const W = pr.width;
  const H = pr.height;

  try {
    await document.fonts.load('24px Caveat');
  } catch {
    /* fall back to the system script font */
  }

  paperEl.style.visibility = "hidden";
  jarEl.classList.add("lean");

  // Screen-space scene: world units are CSS pixels, y up.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(vw, vh);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cv = renderer.domElement;
  cv.className = "stage";
  document.body.appendChild(cv);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, vw, vh, 0, -1000, 1000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e1d2, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-0.4, 0.8, 1);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff4e6, 0.35);
  fill.position.set(0.6, -0.3, 0.5);
  scene.add(fill);

  // The sheet: a grid we can bend point by point.
  const SX = 90;
  const SY = 64;
  const geo = new THREE.PlaneGeometry(W, H, SX, SY);
  const P = geo.attributes.position;
  const flat = Float32Array.from(P.array);
  const R = Math.min(W, H) * 0.34; // radius of the finished ball

  // Where each point ends up: a crumpled sphere, mapped from the sheet.
  const ball = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const u = flat[i * 3] / (W / 2);
    const v = flat[i * 3 + 1] / (H / 2);
    const th = (u + 1) * Math.PI;
    const ph = ((v + 1) * Math.PI) / 2;
    const dx = Math.sin(ph) * Math.cos(th);
    const dy = Math.cos(ph);
    const dz = Math.sin(ph) * Math.sin(th);
    const r = R * (1 + 0.14 * wrinkle(dx * 2.4, dy * 2.4, dz * 2.4));
    ball[i * 3] = dx * r;
    ball[i * 3 + 1] = dy * r;
    ball[i * 3 + 2] = dz * r;
  }

  const map = paperTexture(text, W, H);
  const bump = grainTexture();
  const mat = new THREE.MeshStandardMaterial({
    map,
    bumpMap: bump,
    bumpScale: 1.2,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const sx = pr.left + W / 2;
  const sy = vh - (pr.top + H / 2);
  mesh.position.set(sx, sy, 0);
  mesh.rotation.z = 0.021; // matches the paper's -1.2deg tilt
  scene.add(mesh);

  // Where it lands: the mouth of the jar.
  const tx = jr.left + jr.width / 2;
  const ty = vh - (jr.top + jr.height * 0.16);

  const t0 = performance.now();
  const total = CRUMPLE_MS + TUMBLE_MS + FLY_MS;

  await new Promise((done) => {
    const frame = (now) => {
      const el = now - t0;

      // 1. ball up
      const c = Math.min(1, el / CRUMPLE_MS);
      const e = easeInOut(c);
      const wv = Math.sin(Math.PI * c); // crinkle strength, peaks mid-crumple
      for (let i = 0; i < P.count; i++) {
        const k = i * 3;
        const fx = flat[k];
        const fy = flat[k + 1];
        const nx = wrinkle(fx / W * 5, fy / H * 5, c * 2.0);
        const ny = wrinkle(fx / W * 5 + 3.1, fy / H * 5, c * 2.0 + 1.3);
        const nz = wrinkle(fx / W * 4 + 0.7, fy / H * 4, c * 2.0 + 2.6);
        P.array[k] = fx * (1 - e) + ball[k] * e + wv * 14 * nx;
        P.array[k + 1] = fy * (1 - e) + ball[k + 1] * e + wv * 14 * ny;
        P.array[k + 2] = flat[k + 2] * (1 - e) + ball[k + 2] * e + wv * 34 * nz;
      }
      P.needsUpdate = true;
      geo.computeVertexNormals();

      // 2. a beat of tumbling, then 3. fly into the jar
      const f = Math.max(0, Math.min(1, (el - CRUMPLE_MS - TUMBLE_MS) / FLY_MS));
      const fe = easeInOut(f);
      mesh.rotation.set(fe * 2.4, e * 0.9, 0.021 * (1 - e));
      mesh.position.x = sx + (tx - sx) * fe;
      mesh.position.y = sy + (ty - sy) * fe;
      mesh.scale.setScalar(1 - 0.45 * fe);

      renderer.render(scene, cam);

      if (el < total) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });

  // The jar settles back as the ball lands.
  jarEl.classList.remove("lean");
  jarEl.animate(
    [
      { transform: "scale(1.08)" },
      { transform: "scale(0.985)" },
      { transform: "scale(1)" },
    ],
    { duration: 520, easing: "ease-out" }
  );

  renderer.dispose();
  geo.dispose();
  mat.dispose();
  map.dispose();
  bump.dispose();
  cv.remove();
}

renderJar();
