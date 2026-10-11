// ================= Camera effects: background blur / replace + colour filters =================
// Raw camera track -> hidden <video> -> canvas -> canvas.captureStream() track.
// The processed track is what the rest of the app uses as `camTrack`, so nothing else needs to change.
// Person segmentation runs fully in the browser (MediaPipe, self-hosted in /vendor/mediapipe). No video leaves the device.
(function () {
  const FPS = 24;
  const FILTERS = {
    none: { label: "None", css: "" },
    vivid: { label: "Vivid", css: "saturate(1.45) contrast(1.08)" },
    warm: { label: "Warm", css: "sepia(.25) saturate(1.25) hue-rotate(-10deg) brightness(1.04)" },
    cool: { label: "Cool", css: "saturate(1.1) hue-rotate(12deg) brightness(1.02)" },
    soft: { label: "Soft glow", css: "brightness(1.08) contrast(.92) saturate(1.1) blur(.6px)" },
    vintage: { label: "Vintage", css: "sepia(.55) contrast(1.05) saturate(.9)" },
    mono: { label: "Mono", css: "grayscale(1) contrast(1.1)" },
    noir: { label: "Noir", css: "grayscale(1) contrast(1.4) brightness(.9)" },
  };
  // Built-in backgrounds are drawn with code (no image files needed)
  const SCENES = {
    sunset: { label: "Sunset", draw: (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#2b1055"); g.addColorStop(.5, "#d4457a"); g.addColorStop(1, "#ffb36b"); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = "rgba(255,230,160,.9)"; c.beginPath(); c.arc(w * .72, h * .68, h * .12, 0, 7); c.fill(); } },
    ocean: { label: "Ocean", draw: (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#0f2c5c"); g.addColorStop(.55, "#1c7fb8"); g.addColorStop(1, "#7fe0e8"); c.fillStyle = g; c.fillRect(0, 0, w, h); } },
    forest: { label: "Forest", draw: (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#0b2a1b"); g.addColorStop(1, "#3f9a52"); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = "rgba(10,50,25,.55)"; for (let i = 0; i < 9; i++) { const x = (i + .5) * w / 9, th = h * (.45 + .25 * ((i * 37) % 10) / 10); c.beginPath(); c.moveTo(x, h - th); c.lineTo(x + w * .07, h); c.lineTo(x - w * .07, h); c.fill(); } } },
    office: { label: "Office", draw: (c, w, h) => { c.fillStyle = "#d9dde6"; c.fillRect(0, 0, w, h); c.fillStyle = "#c2c8d4"; c.fillRect(0, h * .72, w, h * .28); c.fillStyle = "#f4f6fb"; c.fillRect(w * .1, h * .12, w * .3, h * .38); c.fillRect(w * .55, h * .12, w * .3, h * .38); c.fillStyle = "#9fd0f5"; c.fillRect(w * .12, h * .15, w * .26, h * .32); c.fillRect(w * .57, h * .15, w * .26, h * .32); } },
    neon: { label: "Neon", draw: (c, w, h) => { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#14052e"); g.addColorStop(.5, "#5b1fa8"); g.addColorStop(1, "#ff3fa4"); c.fillStyle = g; c.fillRect(0, 0, w, h); } },
    dark: { label: "Studio", draw: (c, w, h) => { const g = c.createRadialGradient(w / 2, h * .4, 10, w / 2, h / 2, w * .7); g.addColorStop(0, "#3a3f55"); g.addColorStop(1, "#0a0b10"); c.fillStyle = g; c.fillRect(0, 0, w, h); } },
  };

  const cfg = { bg: "none", filter: "none" }; // bg: none | blur | blur-strong | scene:<id> | custom
  try { Object.assign(cfg, JSON.parse(localStorage.getItem("fx") || "{}")); } catch { /* ignore */ }
  if (cfg.bg === "custom") cfg.bg = "none"; // custom image is not remembered across reloads
  if (!(cfg.filter in FILTERS)) cfg.filter = "none";
  const save = () => { try { localStorage.setItem("fx", JSON.stringify(cfg)); } catch { /* ignore */ } };

  const canSetFilter = (() => { try { return "filter" in document.createElement("canvas").getContext("2d"); } catch { return false; } })();

  let raw = null, out = null, video = null, canvas = null, ctx = null, comp = null, cctx = null, small = null, sctx = null;
  let worker = null, seg = null, segPromise = null, segFailed = false, busy = false, custom = null, sceneCache = {}, listeners = [];
  let lastMask = null;

  const emit = () => listeners.forEach((f) => f({ ...cfg, supported: canSetFilter, segFailed }));

  async function loadSeg() {
    if (seg || segFailed) return seg;
    if (segPromise) return segPromise;
    segPromise = (async () => {
      try {
        if (!window.SelfieSegmentation) {
          await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/vendor/mediapipe/selfie_segmentation.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        }
        const s = new window.SelfieSegmentation({ locateFile: (f) => "/vendor/mediapipe/" + f });
        s.setOptions({ modelSelection: 1 });
        s.onResults((r) => { lastMask = r; drawSegmented(r); });
        await s.initialize();
        seg = s;
      } catch (e) {
        console.error("Background effects unavailable:", e);
        segFailed = true; seg = null;
        if (cfg.bg !== "none") { cfg.bg = "none"; save(); }
        emit();
      }
      return seg;
    })();
    return segPromise;
  }

  function sizeTo(w, h) {
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = comp.width = w; canvas.height = comp.height = h;
  }

  function bgImage(w, h) {
    if (cfg.bg === "custom" && custom) return custom;
    const id = cfg.bg.startsWith("scene:") ? cfg.bg.slice(6) : null;
    if (!id || !SCENES[id]) return null;
    const key = id + w + "x" + h;
    if (!sceneCache[key]) { sceneCache = {}; const c = document.createElement("canvas"); c.width = w; c.height = h; SCENES[id].draw(c.getContext("2d"), w, h); sceneCache[key] = c; }
    return sceneCache[key];
  }

  function coverDraw(c, img, w, h) {
    const iw = img.videoWidth || img.naturalWidth || img.width, ih = img.videoHeight || img.naturalHeight || img.height;
    const s = Math.max(w / iw, h / ih), dw = iw * s, dh = ih * s;
    c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function paintBackground(c, w, h) {
    if (cfg.bg === "blur" || cfg.bg === "blur-strong") {
      // Down-scale + up-scale gives a smooth blur on every browser (no ctx.filter needed)
      const d = cfg.bg === "blur-strong" ? 30 : 14;
      const sw = Math.max(8, Math.round(w / d)), sh = Math.max(8, Math.round(h / d));
      if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
      sctx.drawImage(video, 0, 0, sw, sh);
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
    } else {
      const img = bgImage(w, h);
      if (img) coverDraw(c, img, w, h); else c.drawImage(video, 0, 0, w, h);
    }
  }

  function present() { // comp -> output canvas, applying the colour filter
    ctx.save();
    ctx.filter = canSetFilter ? (FILTERS[cfg.filter].css || "none") : "none";
    ctx.drawImage(comp, 0, 0);
    ctx.restore();
  }

  function drawSegmented(r) {
    if (!video || !r || !r.segmentationMask) return;
    const w = canvas.width, h = canvas.height;
    cctx.save();
    cctx.clearRect(0, 0, w, h);
    cctx.globalCompositeOperation = "source-over";
    if (canSetFilter) cctx.filter = "blur(3px)"; // feather the cut-out edge
    cctx.drawImage(r.segmentationMask, 0, 0, w, h);
    cctx.filter = "none";
    cctx.globalCompositeOperation = "source-in";
    cctx.drawImage(video, 0, 0, w, h); // the person
    cctx.globalCompositeOperation = "destination-over";
    paintBackground(cctx, w, h); // everything else
    cctx.restore();
    present();
  }

  async function tick() {
    if (!video || video.readyState < 2) return;
    sizeTo(video.videoWidth || 640, video.videoHeight || 480);
    const w = canvas.width, h = canvas.height;
    if (cfg.bg === "none") {
      cctx.globalCompositeOperation = "source-over";
      cctx.drawImage(video, 0, 0, w, h);
      present();
      return;
    }
    if (!seg) { // model still loading: show the plain camera meanwhile
      loadSeg();
      cctx.drawImage(video, 0, 0, w, h); present();
      return;
    }
    if (busy) return;
    busy = true;
    try { await seg.send({ image: video }); } catch (e) { console.error(e); } finally { busy = false; }
  }

  function start(rawTrack) {
    stopLoop();
    raw = rawTrack;
    video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute("style", "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none");
    document.body.appendChild(video);
    video.srcObject = new MediaStream([raw]);
    video.play().catch(() => {});
    const st = raw.getSettings ? raw.getSettings() : {};
    canvas = document.createElement("canvas"); comp = document.createElement("canvas"); small = document.createElement("canvas");
    canvas.width = comp.width = st.width || 1280; canvas.height = comp.height = st.height || 720;
    ctx = canvas.getContext("2d"); cctx = comp.getContext("2d"); sctx = small.getContext("2d");
    out = canvas.captureStream(FPS).getVideoTracks()[0];
    const origStop = out.stop.bind(out);
    out.stop = () => { origStop(); stopLoop(); };
    worker = new Worker("/tick-worker.js");
    worker.onmessage = tick;
    worker.postMessage(Math.round(1000 / FPS));
    if (cfg.bg !== "none") loadSeg();
    return out;
  }

  function stopLoop() {
    if (worker) { worker.postMessage(0); worker.terminate(); worker = null; }
    if (raw) { raw.stop(); raw = null; }
    if (video) { video.srcObject = null; video.remove(); video = null; }
    busy = false;
  }

  window.CamFX = {
    FILTERS, SCENES,
    attach: start,
    get: () => ({ ...cfg, supported: canSetFilter, segFailed }),
    onChange: (f) => listeners.push(f),
    setBackground(bg) { cfg.bg = bg; save(); if (bg !== "none") loadSeg(); emit(); },
    setFilter(f) { if (!(f in FILTERS)) return; cfg.filter = f; save(); emit(); },
    setCustomImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => { custom = img; cfg.bg = "custom"; loadSeg(); emit(); resolve(); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
        img.src = url;
      });
    },
  };
})();
