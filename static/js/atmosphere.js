/* atmosphere.js: slow snowfall behind the page.
   Three depths: far flakes are tiny, dim and slow; near flakes are bigger,
   softer and drift more. Stops when the tab is hidden and when the visitor
   prefers reduced motion. */
(() => {
  const canvas = document.getElementById("snow");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LAYERS = [
    { size: [0.6, 1.2], speed: [8, 16], alpha: 0.35, sway: 6, share: 0.55 },
    { size: [1.2, 2.0], speed: [16, 28], alpha: 0.5, sway: 12, share: 0.33 },
    { size: [2.2, 3.4], speed: [30, 48], alpha: 0.42, sway: 22, share: 0.12 },
  ];
  let flakes = [];
  let w = 0;
  let h = 0;
  let dpr = 1;
  let last = 0;
  let running = true;
  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    const sameWidth = w === window.innerWidth && flakes.length;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sameWidth) return;                 // phone address bar moved: keep the flakes
    const total = Math.min(260, Math.round((w * h) / 7000));
    flakes = [];
    LAYERS.forEach((layer) => {
      for (let i = 0; i < Math.round(total * layer.share); i++) {
        flakes.push({ layer, x: rand(0, w), y: rand(0, h), r: rand(...layer.size), v: rand(...layer.speed),
          phase: rand(0, Math.PI * 2), drift: rand(0.15, 0.4) });
      }
    });
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    flakes.forEach((f) => {
      const x = f.x + Math.sin(t / 1000 * f.drift + f.phase) * f.layer.sway;
      const g = ctx.createRadialGradient(x, f.y, 0, x, f.y, f.r * 2.2);
      g.addColorStop(0, `rgba(235, 245, 255, ${f.layer.alpha})`);
      g.addColorStop(1, "rgba(235, 245, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, f.y, f.r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function step(t) {
    if (!running) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    flakes.forEach((f) => {
      f.y += f.v * dt;
      f.x += 4 * dt;                       // a light wind from the west
      if (f.y > h + 8) { f.y = -8; f.x = rand(0, w); }
      if (f.x > w + 8) f.x = -8;
    });
    draw(t);
    requestAnimationFrame(step);
  }

  resize();
  window.addEventListener("resize", resize);
  if (still) { draw(0); return; }
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) { last = 0; requestAnimationFrame(step); }
  });
  requestAnimationFrame(step);
})();
