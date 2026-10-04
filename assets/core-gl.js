/* The particle layer. Experimental -- core.js loads this file only when the
   address carries ?gl=1, and the page is complete without it.

   What it adds: the 2D net is about a hundred nodes and their traces, which
   reads as a drawing of a heart. Twenty thousand faint points underneath give
   it a body -- a volume for the traces to sit on -- and turn the sphere into
   something made of atoms rather than a wireframe. Raw WebGL, one program,
   one draw call. No library: a scene graph, loaders and materials are all
   things one cloud of points has no use for.

   What it does not own: any decision. core.js hands over one object per frame
   (position, scale, the morph values, brightness, palette) and this file
   draws exactly that, so the two layers cannot drift apart. If WebGL is
   missing, a shader fails or the context is lost, the layer takes itself
   away and the 2D net carries on alone. */
(function () {
  "use strict";

  var base = document.getElementById("core");
  if (!base || !window.coreLayer) return;

  var STRIDE = 16, PER_SLICE = 2500, WARM = 6;
  var cv = null, gl = null, prog = null, par = null, buf = null, U = {};
  var count = 0, builtFor = null, job = null, shown = 0;
  var started = false, linked = false, dead = false;

  /* The vertex shader is step() and project() from core.js, for one point:
     the same staggered ease between heart, sheet and sphere, the same
     arrival, the same turn and perspective. Kept line for line so a change
     there has an obvious counterpart here. */
  var VS = [
    "attribute vec3 aHeart, aSheet, aOrb, aCloud;",
    "attribute vec4 aRand;",                    // delay 0..1, size px, alpha, twinkle seed
    "uniform float uSpread, uOrb, uArrive, uHold;",
    "uniform vec2 uRotY, uTiltX, uSpin;",       // (cos, sin) each
    "uniform vec2 uCentre, uView;",
    "uniform float uScale, uDpr, uGain, uPhase, uWaveK, uTime, uPresence;",
    "uniform vec3 uHole;",                      // strength, rx, ry
    "varying float vAlpha;",
    "varying float vHot;",
    "varying float vSize;",
    "float ease(float t) {",
    "  t = clamp(t, 0.0, 1.0);",
    "  if (t < 0.5) return 4.0 * t * t * t;",
    "  float u = 2.0 - 2.0 * t;",
    "  return 1.0 - u * u * u / 2.0;",
    "}",
    /* The nodes take the beat as a flash: an instant rise, 46ms wide. On a
       hundred nodes that is a heartbeat. On twenty thousand points it was a
       strobe -- 4.8% of the local brightness changing every frame at rest,
       measured -- and a strobe reads as stutter. Here the same wave is a
       swell: smooth on both sides, about four times as wide, a third of the
       depth. */
    "float beat(float p) {",
    "  float a = p - 0.06; a -= floor(a + 0.5);",
    "  float b = p - 0.24; b -= floor(b + 0.5);",
    "  a /= 0.07; b /= 0.07;",
    "  return exp(-a * a * 0.5) + exp(-b * b * 0.5) * 0.25;",
    "}",
    "void main() {",
    "  float delay = aRand.x * (1.0 - uHold);",
    "  float e = ease((uSpread - delay) / uHold);",
    "  float g = ease((uOrb - ((1.0 - uHold) - delay)) / uHold);",
    "  vec3 o = vec3(aOrb.x * uSpin.x + aOrb.z * uSpin.y, aOrb.y, aOrb.z * uSpin.x - aOrb.x * uSpin.y);",
    "  vec3 b = mix(mix(aHeart, aSheet, e), o, g);",
    "  float lead = (1.0 - delay) * 0.35;",
    "  float q = max(0.0, (uArrive - lead) / (1.0 - lead));",
    "  b += (aCloud - b) * (q * q * sqrt(q));",
    "  float d = length(b);",
    "  float x1 = b.x * uRotY.x + b.z * uRotY.y;",
    "  float z1 = -b.x * uRotY.y + b.z * uRotY.x;",
    "  float y1 = b.y * uTiltX.x - z1 * uTiltX.y;",
    "  float z2 = b.y * uTiltX.y + z1 * uTiltX.x;",
    "  float persp = 2.4 / (2.4 + z2);",
    "  vec2 px = uCentre + vec2(x1, y1 * 0.94) * uScale * persp;",
    "  gl_Position = vec4(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, 0.0, 1.0);",
    // the beat travels outward from the core, as it does through the nodes
    "  float act = beat(fract(uPhase - d * uWaveK));",
    "  float tw = 0.78 + 0.22 * sin(uTime * (0.6 + aRand.w * 0.9) + aRand.w * 40.0);",
    // nearer is brighter: this is what makes the far side of the sphere recede
    "  float depth = clamp(0.35 + (persp - 0.84) * 2.6, 0.25, 1.25);",
    // the same soft hole the 2D layer punches under the copy
    "  vec2 hv = (px - uView * 0.5) / uHole.yz;",
    "  float hole = 1.0 - uHole.x * (1.0 - smoothstep(0.35, 1.0, length(hv)));",
    /* `size` is the diameter the point should APPEAR to have. The quad is
       drawn a pixel larger all round and the fragment shader puts a soft dot
       at the exact centre -- see there. The last factor keeps the light a
       point gives off the same as it was when it was a hard dot. */
    "  float size = aRand.y * persp * uDpr * (1.0 + act * 0.10);",
    "  gl_PointSize = size + 2.0;",
    "  vSize = size;",
    "  vAlpha = aRand.z * uGain * uPresence * (0.82 + act * 0.38) * tw * depth * hole * min(0.75, 0.27 * size * size);",
    "  vHot = act * 0.7;",
    "}"
  ].join("\n");

  /* A point of one or two pixels drawn as a hard dot lands on whichever pixel
     its centre falls in. Move it a third of a pixel and it either stays put
     or jumps a whole one, and its brightness changes with where in the pixel
     it sat -- so a field of them drifting slowly does not glide, it boils.
     Drawn as a small gaussian about the exact centre instead, a point
     crossing a pixel boundary hands its light over gradually. */
  var FS = [
    "precision mediump float;",
    "uniform vec3 uColA, uColB;",
    "varying float vAlpha;",
    "varying float vHot;",
    "varying float vSize;",
    "void main() {",
    "  vec2 c = (gl_PointCoord - 0.5) * (vSize + 2.0);",   // pixels from the true centre
    "  float sigma = max(0.5, vSize * 0.30);",
    "  float al = vAlpha * exp(-dot(c, c) / (2.0 * sigma * sigma));",
    "  vec3 col = mix(uColA, uColB, clamp(vHot, 0.0, 1.0));",
    "  gl_FragColor = vec4(col * al, al);",       // premultiplied
    "}"
  ].join("\n");

  function rng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 150 });
    else setTimeout(fn, 16);
  }

  function quit() {
    dead = true;
    window.coreLayer(null);
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
  }

  /* ---------- starting up, without being felt ----------

     Compiling two shaders, generating twenty thousand points and the first
     draw (when the driver builds its own pipeline) come to about half a
     second of work. Done as the script loaded, it landed in the middle of the
     hero's entrance: measured, ten dropped frames and stalls of 308ms and
     117ms in the first 0.8s, against none at all without this layer.

     So nothing below runs until the entrance is over. Then: the shaders
     compile off the main thread where the browser offers it, the points are
     generated a slice at a time in idle moments, the first frames are drawn
     with the canvas still transparent, and only then does it fade in. */
  function start() {
    if (dead) return;
    cv = document.createElement("canvas");
    cv.className = "net";
    cv.setAttribute("aria-hidden", "true");
    try {
      gl = cv.getContext("webgl", {
        alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false
      });
    } catch (e) { gl = null; }
    if (!gl) { quit(); return; }
    cv.addEventListener("webglcontextlost", function (ev) { ev.preventDefault(); quit(); });

    par = gl.getExtension("KHR_parallel_shader_compile");
    var vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vs, VS); gl.compileShader(vs);
    gl.shaderSource(fs, FS); gl.compileShader(fs);
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    poll();
  }

  function poll() {
    if (dead) return;
    // asking whether it compiled blocks until the driver is done; asking
    // whether it has FINISHED does not
    if (par && !gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) { setTimeout(poll, 50); return; }
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { quit(); return; }
    gl.useProgram(prog);
    ["uSpread", "uOrb", "uArrive", "uHold", "uRotY", "uTiltX", "uSpin", "uCentre", "uView",
     "uScale", "uDpr", "uGain", "uPhase", "uWaveK", "uTime", "uPresence", "uHole",
     "uColA", "uColB"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    buf = gl.createBuffer();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    /* "Over", not additive. Additive is what makes particle fields glow, and
       it is also what blows a dense region out to white -- the same thing the
       lightness cap on the palette exists to prevent. Here a crowd of points
       can at most add up to the gold itself. */
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    base.parentNode.insertBefore(cv, base);     // underneath the traces
    linked = true;
    window.coreLayer(frame);                    // asks for a frame if core.js is not animating
  }

  /* ---------- the points ---------- */
  function begin(v) {
    job = {
      wide: v.wide, n: v.wide ? 20000 : 7000, p: 0, rnd: rng(20261003),
      halfX: v.halfX, halfY: v.halfY, knot: v.knot, R: v.ORB_R, rows: v.HEART,
      fine: null, line: null, acc: null, total: 0, data: null
    };
    idle(slice);
  }

  function tables(j) {
    /* The heart is drawn from the curve itself rather than from the row
       table core.js keeps for its nodes. That table stops short of the top of
       the lobes -- flat tops, which a hundred nodes on a lattice never show
       and an outline shows at once -- and widens the tip into a stem. Same
       curve, same scaling, finer rows, so the traces still sit inside it. */
    var rows = j.rows, inside = rows.inside, y0 = rows.y0, y1 = rows.y1, maxW = rows.maxW, knot = j.knot;
    var M = 360, fine = [], total = 0;
    for (var i = 0; i < M; i++) {
      var my = -1.0 + 2.26 * i / (M - 1), lo = -1, hi = -1;
      for (var xi = 0; xi <= 640; xi++) {
        var mx = xi * 0.002;
        if (!inside(mx, my)) continue;
        if (lo < 0) lo = mx;
        hi = mx;
      }
      if (hi < 0) continue;
      var ny = -1 + 2 * (my - y0) / (y1 - y0);
      total += Math.max(hi - lo, 0.002);            // cumulative, for an even spread over the AREA
      fine.push([lo / maxW * knot, hi / maxW * knot, -ny * knot * 0.94, total]);
    }
    // the outline as one polyline, right half: up the outer edge, over the
    // lobe, down the cleft. Sampled by arc length so the top of the lobes is
    // as well drawn as the sides.
    var line = [], F = fine.length;
    for (var a = 0; a < F; a++) line.push([fine[a][1], fine[a][2]]);
    for (var c = F - 1; c >= 0; c--) {
      if (fine[c][0] <= 0.0008) break;
      line.push([fine[c][0], fine[c][2]]);
    }
    var acc = [0];
    for (var s = 1; s < line.length; s++) {
      var lx = line[s][0] - line[s - 1][0], ly = line[s][1] - line[s - 1][1];
      acc.push(acc[s - 1] + Math.sqrt(lx * lx + ly * ly));
    }
    j.fine = fine; j.line = line; j.acc = acc; j.total = total;
    j.data = new Float32Array(j.n * STRIDE);
  }

  function slice() {
    var j = job;
    if (dead || !j) return;
    if (!j.fine) { tables(j); idle(slice); return; }

    var rnd = j.rnd, data = j.data, fine = j.fine, line = j.line, acc = j.acc;
    var F = fine.length, knot = j.knot, end = Math.min(j.n, j.p + PER_SLICE);
    for (var p = j.p; p < end; p++) {
      var o = p * STRIDE, hx, hy, hz, size, alpha;
      if (rnd() < 0.28) {
        // on the outline
        var want = rnd() * acc[acc.length - 1], lo = 0, hi = acc.length - 1;
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (acc[mid] <= want) lo = mid; else hi = mid; }
        var t = (want - acc[lo]) / Math.max(1e-6, acc[hi] - acc[lo]);
        var jr = 0.012 * rnd() * rnd(), ja = rnd() * 6.2832;
        hx = (line[lo][0] + (line[hi][0] - line[lo][0]) * t + Math.cos(ja) * jr) * (rnd() < 0.5 ? -1 : 1);
        hy = line[lo][1] + (line[hi][1] - line[lo][1]) * t + Math.sin(ja) * jr;
        hz = (rnd() - 0.5) * 0.03;
        size = 1.2 + rnd() * 1.0;
        alpha = 0.22 + rnd() * 0.30;
      } else {
        // in the body, thick in the middle and thin at the rim
        var pick = rnd() * j.total, r0 = 0, r1 = F - 1;
        while (r1 > r0) { var md = (r0 + r1) >> 1; if (fine[md][3] < pick) r0 = md + 1; else r1 = md; }
        var row = fine[r0], row2 = fine[Math.min(F - 1, r0 + 1)], k = rnd();
        var inner = row[0] + (row2[0] - row[0]) * k, outer = row[1] + (row2[1] - row[1]) * k;
        var ax = rnd();
        hx = (inner + (outer - inner) * ax) * (rnd() < 0.5 ? -1 : 1);
        hy = row[2] + (row2[2] - row[2]) * k;
        var u = rnd();
        hz = -(1 - ax) * knot * 0.75 * (1 - 1.7 * u * u) + (rnd() - 0.5) * 0.02;
        var bright = rnd();
        size = 1.0 + bright * bright * 1.4;
        alpha = 0.07 + bright * bright * 0.22;
      }
      if (rnd() < 0.03) { size = 2.8 + rnd() * 0.9; alpha = 0.5 + rnd() * 0.2; }   // a few that stand out

      var sx = (rnd() * 2 - 1) * j.halfX, sy = (rnd() * 2 - 1) * j.halfY, sz = (rnd() - 0.5) * 0.22;
      // even over the surface of the sphere; a few inside so it has substance
      var oy = rnd() * 2 - 1, lon = rnd() * 6.2832;
      var rad = j.R * (1 + (rnd() - 0.5) * 0.05);
      if (rnd() < 0.10) rad *= Math.pow(rnd(), 1 / 3);
      var ring = Math.sqrt(Math.max(0, 1 - oy * oy)) * rad;

      data[o] = hx; data[o + 1] = hy; data[o + 2] = hz;
      data[o + 3] = sx; data[o + 4] = sy; data[o + 5] = sz;
      data[o + 6] = Math.sin(lon) * ring; data[o + 7] = oy * rad; data[o + 8] = Math.cos(lon) * ring;
      data[o + 9] = sx * 1.35 + (rnd() - 0.5) * 0.42;
      data[o + 10] = sy * 1.35 + (rnd() - 0.5) * 0.42;
      data[o + 11] = (rnd() - 0.5) * 0.9;
      data[o + 12] = rnd(); data[o + 13] = size; data[o + 14] = alpha; data[o + 15] = rnd();
    }
    j.p = end;
    if (end < j.n) { idle(slice); return; }

    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      var names = ["aHeart", "aSheet", "aOrb", "aCloud", "aRand"], sizes = [3, 3, 3, 3, 4], off = 0;
      for (var q = 0; q < names.length; q++) {
        var loc = gl.getAttribLocation(prog, names[q]);
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, sizes[q], gl.FLOAT, false, STRIDE * 4, off * 4);
        }
        off += sizes[q];
      }
    } catch (err) { quit(); return; }
    count = j.n; builtFor = j.wide; job = null;
    window.coreLayer(frame);
  }

  /* ---------- drawing ---------- */
  function render(v) {
    /* Follows the 2D canvas through its reveal and its state-change dip --
       except for its own first few frames, which are drawn unseen: the
       driver builds its pipeline on the first draw, and that should not be
       something anyone watches. Then it fades in slowly, as a second beat
       after the traces have arrived. */
    var lit = (shown >= WARM || v.reduced) && base.classList.contains("is-lit");
    var cls = lit ? "net is-lit" : "net";
    if (cv.className !== cls) {
      if (lit && !v.reduced) {
        cv.style.transition = "opacity 1.4s ease";
        setTimeout(function () { if (cv) cv.style.transition = ""; }, 1700);
      }
      cv.className = cls;
    }
    if (cv.style.opacity !== base.style.opacity) cv.style.opacity = base.style.opacity;

    var pr = Math.min(v.dpr, v.wide ? 2 : 1.5);
    var W = Math.round(v.w * pr), H = Math.round(v.h * pr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      cv.style.width = v.w + "px"; cv.style.height = v.h + "px";
      gl.viewport(0, 0, W, H);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    shown++;
    if (v.gain <= 0.004) return;

    var packed = 1 - Math.max(v.spread, v.orb);          // 1 while it is a heart
    var hole = Math.min(1, Math.max(0, (v.spread - 0.12) / 0.5)) * (v.wide ? 1 - v.orb * 0.85 : 1);
    var rx = v.wide ? v.w * 0.38 : v.w * 0.62;

    gl.uniform1f(U.uSpread, v.spread); gl.uniform1f(U.uOrb, v.orb);
    gl.uniform1f(U.uArrive, v.arrive); gl.uniform1f(U.uHold, v.HOLD);
    gl.uniform2f(U.uRotY, Math.cos(v.rotY), Math.sin(v.rotY));
    gl.uniform2f(U.uTiltX, Math.cos(v.tiltX * 0.5), Math.sin(v.tiltX * 0.5));
    gl.uniform2f(U.uSpin, Math.cos(v.spin), Math.sin(v.spin));
    gl.uniform2f(U.uCentre, v.cx, v.cy); gl.uniform2f(U.uView, v.w, v.h);
    gl.uniform1f(U.uScale, v.scale); gl.uniform1f(U.uDpr, pr);
    /* The section keyframes turn the whole net down to 0.28 by the last
       section, which is right for traces that run behind the copy. The
       sphere of points sits beside the copy on a wide screen, and at that
       level it all but disappears -- so there it is given a floor. */
    gl.uniform1f(U.uGain, Math.max(v.gain, (v.wide ? 0.36 : 0) * v.orb));
    gl.uniform1f(U.uPhase, v.phase); gl.uniform1f(U.uWaveK, v.WAVE / v.maxD);
    gl.uniform1f(U.uTime, v.reduced ? 0 : v.clock / 1000);
    /* As a heart the points are packed into a small area and would read as
       fog, so they are held back; as a sheet they sit behind the copy and
       are held back further; as a sphere they are the main event. */
    gl.uniform1f(U.uPresence, (1 - 0.45 * packed) * (1 - 0.7 * v.spread * (1 - v.orb)) *
      (1 + (v.wide ? 1.2 : 0.3) * v.orb));
    gl.uniform3f(U.uHole, hole * 0.9, rx, rx * (v.wide ? 0.72 : 1.05));
    var a = v.pal.node, b = v.pal.sig;
    gl.uniform3f(U.uColA, a[0] / 255, a[1] / 255, a[2] / 255);
    gl.uniform3f(U.uColB, b[0] / 255, b[1] / 255, b[2] / 255);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  // the one function core.js calls, from the first frame to the last
  function frame(v) {
    if (dead) return;
    try {
      if (!started) {
        // not while the net is still arriving
        if (!base.classList.contains("is-lit") || v.arrive > 0) return;
        started = true;
        idle(start);
        return;
      }
      if (!linked) return;
      if (builtFor !== v.wide) {
        if (!job || job.wide !== v.wide) begin(v);
        if (cv.width) gl.clear(gl.COLOR_BUFFER_BIT);     // nothing stale while it rebuilds
        return;
      }
      render(v);
    } catch (err) { quit(); }
  }

  window.coreLayer(frame);
})();
