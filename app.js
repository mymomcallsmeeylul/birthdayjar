(() => {
  const STORAGE_KEY = "birthday-jar-notes";
  const MAX_PAPERS_SHOWN = 80;
  const PILE_STEP = 3;   // % of jar height per note
  const PILE_MAX = 88;   // % cap so the jar never looks completely full

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

  function saveNotes(notes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
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
    const pileTop = pileHeight(count);

    shown.forEach((note, i) => {
      const rnd = seeded(note.seed || i + 1);
      const el = document.createElement("div");
      el.className = "mini-paper";
      const left = 10 + rnd() * 52;                      // % across the jar
      const bottom = 2 + rnd() * Math.max(pileTop - 12, 2); // % up the jar
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

    const note = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      text,
      seed: Math.floor(Math.random() * 1e9) + 1,
      createdAt: new Date().toISOString(),
    };

    await foldNote(paper);
    await flyIntoJar(note);

    notes.push(note);
    saveNotes(notes);
    renderJar(true);

    closeEditor();
    textarea.value = "";
    backBtn.disabled = false;
    sending = false;
  });

  // ---------- fold animation (placeholder, replace with your code) ----------
  // Takes the paper element and resolves when the fold is finished.
  function foldNote(el) {
    return el.animate(
      [
        { transform: "rotate(-1.2deg) scale(1)" },
        { transform: "perspective(800px) rotateX(55deg) scale(1, 0.8)", offset: 0.35 },
        { transform: "perspective(800px) rotateX(-8deg) scale(0.6)", offset: 0.7 },
        { transform: "rotate(-3deg) scale(0.22, 0.18)" },
      ],
      { duration: 900, easing: "ease-in-out", fill: "forwards" }
    ).finished;
  }

  // ---------- move the folded paper into the jar ----------
  function flyIntoJar(note) {
    const from = paper.getBoundingClientRect();
    const target = jar.getBoundingClientRect();

    // Clone the paper so it can travel above the overlay.
    const flyer = paper.cloneNode(false);
    flyer.classList.add("flyer");
    flyer.removeAttribute("id");
    flyer.style.animation = "none";
    flyer.style.left = from.left + "px";
    flyer.style.top = from.top + "px";
    flyer.style.width = from.width + "px";
    flyer.style.height = from.height + "px";
    flyer.style.transform = "rotate(-3deg) scale(0.22, 0.18)";
    flyer.style.opacity = "1";
    document.body.appendChild(flyer);

    // Hide the real paper while the flyer moves.
    overlay.style.background = "rgba(247, 243, 234, 0)";
    overlay.style.transition = "background 0.6s";
    paper.style.visibility = "hidden";

    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    const endX = target.left + target.width / 2;
    const endY = target.top + target.height * 0.12;
    const dx = endX - startX;
    const dy = endY - startY;

    const anim = flyer.animate(
      [
        { transform: "translate(0, 0) rotate(-3deg) scale(0.22, 0.18)", offset: 0 },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 80}px) rotate(-8deg) scale(0.2, 0.16)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(12deg) scale(0.1, 0.08)`, offset: 1 },
      ],
      { duration: 1000, easing: "cubic-bezier(0.5, 0, 0.7, 1)", fill: "forwards" }
    );

    return anim.finished.then(() => {
      flyer.remove();
      paper.style.visibility = "";
      overlay.style.background = "";
      overlay.style.transition = "";
    });
  }

  renderJar();
})();
