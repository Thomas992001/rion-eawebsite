/* Neural net — the page's background, opened by scroll.

   Machine, not tissue. Three things carry that:

   1. Nodes are squares and every one of them sits on a lattice point. Their
      placement is still irregular (blue-noise draw, no rows or columns), but
      each lands on the grid, the way things do in a machine.
   2. Links are routed like circuit traces — straight run, 45-degree elbow,
      straight run — never a curve and never a random diagonal.
   3. Every pulse leaves the core node at the centre and travels outward along
      the wiring, released on the clock. The activation wave radiates from the
      same point, so the far edge of the shape lights up last.

   Balled up at the top of the page it is that same net folded into a compact
   lattice knot, with the core lit at the centre. Scrolling unfolds it — each
   node lets go at its own point in the scroll — over about one and a half
   screens.

   Static for visitors who ask for reduced motion. */
(function () {
  "use strict";

  var canvas = document.getElementById("core");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var me = document.currentScript;      // only readable now, while this file runs

  /* Hue and saturation are not what decides whether a colour reads as gold:
     lightness is. The core sat at 85% and the pulse crest at 92%, and above
     about 80% everything washes out to white however saturated it is -- which
     is why the heartbeat flashed white on a gold net. Hue and saturation are
     untouched here; only lightness is capped, at 74% for the core and 79% for
     the crest, which keeps the crest clearly brighter than a resting node
     (65%) without leaving the hue behind. */
  var PAL = {
    online: { node: [228, 189, 104], link: [206, 169, 86], core: [239, 210, 139], sig: [247, 224, 156] },
    idle:   { node: [162, 170, 186], link: [132, 140, 156], core: [174, 184, 204], sig: [186, 197, 217] },
    halted: { node: [198, 124, 108], link: [168, 104, 92], core: [226, 156, 138], sig: [242, 181, 161] }
  };

  var SEED = 20260919;
  var CYCLE_MS = 1100;        // one forward pass
  var WAVE = 0.42;            // share of a cycle the wave takes to cross the net
  var MAX_SIGNALS = 30;
  /* ---------- the morph track ----------

     Driving the shape off raw scroll fractions meant it changed "somewhere"
     rather than at the moment the page asked for it -- and it left the net at
     its widest and busiest right across section 02, which is the one screen
     where the figures have to be read without anything competing. A system
     that steps back while you read its numbers is itself the trust signal;
     decoration that fights the data says the opposite.

     So the state is keyed to the sections instead. Each keyframe is where the
     net should have got to by the time that section is in reading position:

       hero   a heart, bright, beating in its own band -- the thing is alive
       02     recedes to almost nothing; only the pulse stays, so the figures
              own the screen
       03     opens into the net, exactly where the copy describes the path the
              summary travels -- the words and the picture argue together
       04     gathers into a sphere and moves aside: the system as one object,
              out of the way of the rules being listed
       05-07  settles and keeps dimming; it has said its piece

     Shape and position are separate (spread/orb vs pin), because 02 needs the
     heart to stay small while still following the viewport. */
  /* The last anchor is 06, not 07: on a wide screen 07 sits past the end of
     the scroll, so a keyframe there would never be reached -- and 06 is the
     section with the one action on the page, which is exactly where the
     background should be quietest. */
  var STAGE_IDS = ["performance", "chain", "how", "risk", "follow"];
  var TRACK = [
    { spread: 0, orb: 0, pin: 0, dim: 1.00 },   // hero
    { spread: 0, orb: 0, pin: 1, dim: 0.20 },   // 02 the figures
    { spread: 1, orb: 0, pin: 1, dim: 0.55 },   // 03 the path
    { spread: 1, orb: 1, pin: 1, dim: 0.42 },   // 04 the rules
    { spread: 1, orb: 1, pin: 1, dim: 0.34 },   // 05 risk
    { spread: 1, orb: 1, pin: 1, dim: 0.28 }    // 06 how copying works
  ];
  /* A keyframe is REACHED just as its section arrives at the top of the
     screen, and the move into it takes a fixed stretch of scroll rather than a
     share of the gap -- section 02 is 1784px tall while 03 to 04 is only 736,
     so a percentage would have made one change crawl and the next one snap. */
  var LEAD = 0.10;              // the anchor sits this far above the section
  var TRANS = 0.60;             // a change takes this many screens, at most
                                // (0.80 started the opening while the ledger --
                                // another table of figures -- was still up)
  var ORB_R = 0.42;                      // sphere radius, in the same units as
                                         // the spread sheet (which spans ~0.54)
  var HOLD = 0.44;
  var NEIGHBOURS = 4;
  var GRID = 1 / 52;          // everything snaps to this lattice

  var state = "idle";
  var nodes = [], edges = [], adj = [], tangle = [], bus = [], signals = [], sigN = 0;
  var heartId = 0, minX = -1, maxX = 1;
  var w = 0, h = 0, dpr = 1, wide = false;
  var clock = 0, last = 0, cycles = 0, extra = 0;
  var spread = 0, orb = 0, pin = 0, dim = 1;
  var arrive = 0;             // 1 = scattered, eases to 0 as the net gathers
  var rotY = 0, tiltX = 0, tiltY = 0, tiltTX = 0, tiltTY = 0;
  /* The sphere turns on its own axis the whole time it exists: one revolution
     every 36 seconds, front face moving left, so nodes keep emerging from the
     right-hand edge into the frame. Slow enough to read as a globe idling, not
     a spinner. Applied to the sphere's own coordinates before the blend, so
     the sheet and the heart never turn with it. Off under reduced motion. */
  var SPIN_MS = 36000, spin = 0;
  var pointer = { x: -9999, y: -9999, on: false };

  /* An optional second layer draws underneath this one from the same numbers:
     assets/core-gl.js, a WebGL particle field, loaded only when the address
     carries ?gl=1. This file stays the single owner of the choreography --
     the track, the dock, the smoothing, the state -- and hands the result
     over once a frame; the layer only renders it. If the layer never loads,
     or WebGL is not there, nothing in this file behaves differently. */
  var view = { maxD: 1 }, layer = null;
  var scrollY = 0;
  var running = false;

  function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (a < 0 ? 0 : a > 1 ? 1 : a) + ")";
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function easeInOut(t) {
    if (t < 0.5) return 4 * t * t * t;
    var u = 2 - 2 * t;
    return 1 - u * u * u / 2;
  }

  /* A heart, sampled from the implicit curve (x^2 + y^2 - 1)^3 - x^2 y^3 = 0.
     For each height we record the inside span as [inner, outer] half-widths —
     near the top the two lobes are separated by a cleft, so inner > 0 there.
     Heights and widths are normalised to [-1, 1]. */
  var HEART = (function () {
    var B = 120, SX = 260, X0 = -1.35, X1 = 1.35, Y0 = -1.35, Y1 = 1.15;
    function inside(x, y) {
      var a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y <= 0;
    }
    var rows = [];
    for (var b = 0; b < B; b++) {
      var y = Y0 + ((Y1 - Y0) * b) / (B - 1);
      var lo = 1e9, hi = -1e9;
      for (var i = 0; i <= SX; i++) {
        var x = X0 + ((X1 - X0) * i) / SX;
        if (!inside(x, y)) continue;
        var ax = Math.abs(x);
        if (ax < lo) lo = ax;
        if (ax > hi) hi = ax;
      }
      rows.push(hi < 0 ? [0, 0] : [lo === 1e9 ? 0 : lo, hi]);
    }
    var maxW = 0;
    for (var m = 0; m < B; m++) if (rows[m][1] > maxW) maxW = rows[m][1];
    for (var n = 0; n < B; n++) { rows[n][0] /= maxW; rows[n][1] /= maxW; }
    // for the particle layer, which draws the outline from the curve itself
    rows.inside = inside; rows.y0 = Y0; rows.y1 = Y1; rows.maxW = maxW;
    return rows;
  })();

  // |nx| maps across the inside span at that height, so the cleft stays empty
  function heartX(nx, ny) {
    var f = ((Math.max(-1, Math.min(1, ny)) + 1) / 2) * (HEART.length - 1);
    var i = Math.max(0, Math.min(HEART.length - 2, Math.floor(f)));
    var k = f - i;
    var inner = HEART[i][0] + (HEART[i + 1][0] - HEART[i][0]) * k;
    var outer = HEART[i][1] + (HEART[i + 1][1] - HEART[i][1]) * k;
    // the tip narrows to nothing, which would stack nodes into a bright column
    if (outer < 0.085) outer = 0.085;
    if (inner > outer) inner = outer;
    var a = Math.abs(nx);
    return (nx < 0 ? -1 : 1) * (inner + (outer - inner) * a);
  }

  function snap(v) { return Math.round(v / GRID) * GRID; }

  /* ---------- the net ---------- */
  function build() {
    var rnd = mulberry32(SEED);
    /* 58 was a performance decision from before the draw loop was rebuilt --
       fillRect went from 610 a frame to 232, and the packets stopped
       allocating. The heart was visibly thinner on a phone than on a desktop
       for no reason that still applies. */
    var count = wide ? 104 : 84;
    var halfX = wide ? 0.54 : 0.64;
    var halfY = wide ? 0.44 : 0.42;
    var knot = wide ? 0.27 : 0.30;
    view.halfX = halfX; view.halfY = halfY; view.knot = knot;

    // blue noise: even spacing, irregular pattern — no rows, no columns
    var pts = [];
    for (var i = 0; i < count; i++) {
      var best = null, bestD = -1;
      for (var c = 0; c < 14; c++) {
        var px = rnd() * 2 - 1, py = rnd() * 2 - 1;
        var near = 1e9;
        for (var q = 0; q < pts.length; q++) {
          var dx = (px - pts[q][0]) * halfX, dy = (py - pts[q][1]) * halfY;
          var d = dx * dx + dy * dy;
          if (d < near) near = d;
        }
        if (near > bestD) { bestD = near; best = [px, py]; }
      }
      pts.push(best);
    }

    nodes = []; tangle = []; bus = []; resetSignals();
    for (var n = 0; n < pts.length; n++) {
      var nx = pts[n][0], ny = pts[n][1];
      // Collapsed, the sheet folds into a heart: for a given height the heart's
      // half-width scales the node's horizontal position, so the square of
      // blue-noise points fills the heart's area and neighbours stay neighbours.
      var hx = heartX(nx, ny);
      var lift = 1 - Math.min(1, Math.abs(nx));        // centre of the body sits forward
      /* The sheet is wrapped onto the sphere by equal area -- height maps
         straight to height, and each latitude's ring radius is sqrt(1 - y^2).
         A plain lat/long wrap would crowd everything at the poles; this keeps
         the spacing even, and more importantly it keeps neighbours neighbours,
         so the traces (wired from the spread layout) stay short instead of
         becoming chords across the middle. */
      var ring = Math.sqrt(Math.max(0, 1 - ny * ny)) * ORB_R;
      var lon = nx * Math.PI;
      nodes.push({
        sx: snap(nx * halfX),
        sy: snap(ny * halfY),
        sz: snap((rnd() - 0.5) * 0.22),
        ox: snap(Math.sin(lon) * ring),
        oy: snap(ny * ORB_R),
        oz: snap(Math.cos(lon) * ring),
        /* Where each node arrives FROM on first reveal. A scaled copy of the
           spread sheet read as a bigger grid, not a cloud; a random offset per
           node and real depth make it loose, so the gather reads as
           condensing rather than as a page shrinking. */
        ax: snap(nx * halfX * 1.35 + (rnd() - 0.5) * 0.42),
        ay: snap(ny * halfY * 1.35 + (rnd() - 0.5) * 0.42),
        az: snap((rnd() - 0.5) * 0.9),
        cx: snap(hx * knot),
        cy: snap(-ny * knot * 0.94),
        /* Perspective scales POSITION, not just size: a node's x and y are
           multiplied by 2.4 / (2.4 + z). The previous version pushed the rim
           back and the centre forward, which shrank the outline by 8% and
           bulged the middle by 10% -- and the outline is what makes a heart a
           heart. So the rim sits at z = 0 (outline exactly as drawn) and only
           the interior comes forward, ~8% at the centre: volume without
           deforming the silhouette. */
        cz: snap(-lift * knot * 0.75 + (rnd() - 0.5) * knot * 0.12),
        delay: rnd() * (1 - HOLD),
        delay2: 0,
        size: rnd() < 0.22 ? 2.6 : 1.9,
        act: 0, d: 0, x: 0, y: 0, s: 1,
        bx: 0, by: 0, bz: 0
      });
    }

    for (var g0 = 0; g0 < nodes.length; g0++) {
      nodes[g0].delay2 = (1 - HOLD) - nodes[g0].delay;   // gather from the far end
    }

    minX = 1e9; maxX = -1e9;
    for (var b = 0; b < nodes.length; b++) {
      if (nodes[b].sx < minX) minX = nodes[b].sx;
      if (nodes[b].sx > maxX) maxX = nodes[b].sx;
    }

    // wire to nearest neighbours in the spread layout
    edges = []; adj = [];
    for (var a = 0; a < nodes.length; a++) adj.push([]);
    var seen = {};
    for (var k = 0; k < nodes.length; k++) {
      var list = [];
      for (var m = 0; m < nodes.length; m++) {
        if (m === k) continue;
        var ddx = nodes[k].sx - nodes[m].sx, ddy = nodes[k].sy - nodes[m].sy;
        list.push([ddx * ddx + ddy * ddy, m]);
      }
      list.sort(function (p, r) { return p[0] - r[0]; });
      for (var j = 0; j < NEIGHBOURS && j < list.length; j++) {
        var other = list[j][1];
        var key = Math.min(k, other) + ":" + Math.max(k, other);
        if (seen[key]) continue;
        seen[key] = 1;
        var id = edges.length;
        edges.push({ a: k, b: other });
        adj[k].push(id);
        adj[other].push(id);
      }
    }

    // extra strands computed on the folded positions: these pack the knot, and
    // fade out as it opens so the spread net stays readable
    for (var u = 0; u < nodes.length; u++) {
      var cand = [];
      for (var v = 0; v < nodes.length; v++) {
        if (v === u) continue;
        var tx = nodes[u].cx - nodes[v].cx, ty = nodes[u].cy - nodes[v].cy, tz = nodes[u].cz - nodes[v].cz;
        cand.push([tx * tx + ty * ty + tz * tz, v]);
      }
      cand.sort(function (p3, r3) { return p3[0] - r3[0]; });
      for (var t2 = 0; t2 < 3 && t2 < cand.length; t2++) {
        var o2 = cand[t2][1];
        var key2 = Math.min(u, o2) + ":" + Math.max(u, o2);
        if (seen[key2]) continue;
        seen[key2] = 1;
        tangle.push({ a: u, b: o2 });
      }
    }

    // a few long runs across the whole net: a board has buses, not only
    // short hops between neighbours
    var byX = [];
    for (var s2 = 0; s2 < nodes.length; s2++) byX.push(s2);
    byX.sort(function (l, r2) { return nodes[l].sx - nodes[r2].sx; });
    for (var g3 = 0; g3 < 11; g3++) {
      var left = byX[(g3 * 3) % Math.max(1, Math.floor(byX.length * 0.3))];
      var right = byX[byX.length - 1 - ((g3 * 5) % Math.max(1, Math.floor(byX.length * 0.3)))];
      if (left === right) continue;
      bus.push({ a: left, b: right });
    }

    heartId = 0;
    var bestC = 1e9;
    for (var p2 = 0; p2 < nodes.length; p2++) {
      var dc = nodes[p2].sx * nodes[p2].sx + nodes[p2].sy * nodes[p2].sy;
      if (dc < bestC) { bestC = dc; heartId = p2; }
    }
    var core = nodes[heartId];
    core.cx = 0; core.cy = 0; core.cz = 0;
    core.ox = 0; core.oy = 0; core.oz = 0;   // the core sits at the sphere's centre
    core.ax = 0; core.ay = 0; core.az = 0;   // and it is the one point that does not arrive
    /* The core was pinned to the centre only in the collapsed state. Its spread
       position was left wherever the lattice put it -- the node NEAREST the
       origin, which is not the same as at it -- and the search above only
       looked at sx and sy, never sz. So as the net opened the core drifted:
       sx alone moved it, and rotY (which ramps to 0.12rad with the scroll)
       turned that leftover sz into sideways travel as well. Measured 24px to
       the right on a 375px phone. It is the focal point of the page; it holds
       the centre in both states. */
    core.sx = 0; core.sy = 0; core.sz = 0;
    core.delay = 0;
    core.size = 6.5;

    for (var f = 0; f < nodes.length; f++) {
      nodes[f].bx = nodes[f].cx; nodes[f].by = nodes[f].cy; nodes[f].bz = nodes[f].cz;
    }

    allocBatches();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var doc = document.documentElement;
    w = Math.max(1, doc.clientWidth || window.innerWidth);
    h = Math.max(1, doc.clientHeight || window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var nowWide = w >= 900;
    if (nowWide !== wide || !nodes.length) { wide = nowWide; build(); }
    measureBand();
  }

  /* ---------- the clock ---------- */
  /* The beat envelope is a pure function of phase, but it was being evaluated
     per node per frame: four transcendentals x ~104 nodes x 60fps. Sampled once
     into a table instead and read with linear interpolation. */
  var ENV_N = 1024;
  var ENV = new Float32Array(ENV_N + 1);
  (function () {
    for (var i = 0; i <= ENV_N; i++) {
      var p = i / ENV_N;
      var a = (p - 0.02) / 0.042, b = (p - 0.14) / 0.030;
      ENV[i] = Math.exp(-a * a * 0.5) + Math.exp(-b * b * 0.5) * 0.32;
    }
  })();
  function envelope(p) {
    p -= Math.floor(p);
    var f = p * ENV_N, i = f | 0, k = f - i;
    return ENV[i] + (ENV[i + 1] - ENV[i]) * k;
  }
  function phaseNow() { return (clock % CYCLE_MS) / CYCLE_MS; }

  // heart -> sheet by e, then sheet -> sphere by g
  function mix3(a, b, c, e, g) {
    var v = a + (b - a) * e;
    return v + (c - v) * g;
  }

  /* How far to move towards a target this frame. The old form, dt/tau clamped
     to 1, is only correct at one frame length: a run of 16ms, 33ms, 16ms frames
     makes the easing itself lurch, which adds visible jitter on top of whatever
     caused the uneven frames. This is the exponential equivalent, so the same
     amount of real time always produces the same amount of movement. */
  function approach(dt, tau) { return 1 - Math.exp(-dt / tau); }

  /* Every pulse leaves the core node and travels outward: a signal only moves
     to a neighbour that is further from the centre than the node it is on. */
  function outwardFrom(id) {
    var links = adj[id], out = [];
    for (var i = 0; i < links.length; i++) {
      var e = edges[links[i]];
      var other = e.a === id ? e.b : e.a;
      if (nodes[other].d > nodes[id].d) out.push(links[i]);
    }
    return out;
  }

  /* Packets are drawn from a fixed pool. They used to be object literals
     created and thrown away at every beat -- a few hundred short-lived objects
     a second, which the collector eventually reclaims all at once. That shows
     up as an occasional dropped frame, not as a steady cost, so it reads as a
     hitch rather than as slowness. Nothing is allocated here now. */
  function resetSignals() {
    if (signals.length !== MAX_SIGNALS) {
      signals.length = 0;
      for (var i = 0; i < MAX_SIGNALS; i++) signals.push({ from: 0, to: 0, t: 0, speed: 0 });
    }
    sigN = 0;
  }
  function addSignal(from, to) {
    if (sigN >= MAX_SIGNALS) return;
    var sg = signals[sigN++];
    sg.from = from; sg.to = to; sg.t = 0; sg.speed = 0.0019;
  }

  function fire(count) {
    var links = adj[heartId];
    if (!links || !links.length) return;
    for (var k = 0; k < count && sigN < MAX_SIGNALS; k++) {
      var e = edges[links[(Math.random() * links.length) | 0]];
      addSignal(heartId, e.a === heartId ? e.b : e.a);
    }
  }

  function relay(id, cameFrom) {
    var out = outwardFrom(id);
    if (!out.length) return;
    // a pulse can fork, so one beat spreads as a branching front
    var branches = Math.random() < 0.18 ? 2 : 1;
    for (var b = 0; b < branches && sigN < MAX_SIGNALS; b++) {
      var e = edges[out[(Math.random() * out.length) | 0]];
      var next = e.a === id ? e.b : e.a;
      if (next === cameFrom) continue;
      addSignal(id, next);
    }
  }

  function step(dt) {
    clock += dt;
    var cycleIndex = Math.floor(clock / CYCLE_MS);
    if (cycleIndex !== cycles) { cycles = cycleIndex; fire(6); }
    if (extra > 0) extra -= dt;

    scrollY = window.pageYOffset || 0;
    if (arrive > 0) { arrive -= dt / 1400; if (arrive < 0) arrive = 0; }
    var k = trackAt(scrollY);
    /* These were tuned when the scroll position arrived in jumps and the
       smoothing had real work to do. The wheel is damped now, so the input is
       already eased -- another 150-210ms on top only puts the background
       behind the words it belongs to. Roughly halved: still enough to filter
       the raw jitter of a touch scroll or `?scroll=plain`, not enough to lag. */
    spread += (k.spread - spread) * approach(dt, 80);
    orb += (k.orb - orb) * approach(dt, 110);
    pin += (k.pin - pin) * approach(dt, 80);
    dim += (k.dim - dim) * approach(dt, 100);

    // The core is morphed first, so the morph and the distance-from-core pass
    // can be a single walk over the nodes instead of two.
    if (!reduced) spin += dt * (Math.PI * 2 / SPIN_MS);
    var spc = Math.cos(spin), sps = Math.sin(spin);
    var core = nodes[heartId];
    var ce = easeInOut(Math.max(0, Math.min(1, (spread - core.delay) / HOLD)));
    var cg = easeInOut(Math.max(0, Math.min(1, (orb - core.delay2) / HOLD)));
    core.bx = mix3(core.cx, core.sx, core.ox * spc + core.oz * sps, ce, cg);
    core.by = mix3(core.cy, core.sy, core.oy, ce, cg);
    core.bz = mix3(core.cz, core.sz, core.oz * spc - core.ox * sps, ce, cg);
    core.d = 0;
    var cbx = core.bx, cby = core.by, cbz = core.bz;

    // the beat is a wave travelling out from the core, so the far edge lights
    // up last; distance is measured in the shape the net is currently in
    var maxD = 0.0001;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === core) continue;
      var e = easeInOut(Math.max(0, Math.min(1, (spread - n.delay) / HOLD)));
      var g = easeInOut(Math.max(0, Math.min(1, (orb - n.delay2) / HOLD)));
      n.bx = mix3(n.cx, n.sx, n.ox * spc + n.oz * sps, e, g);
      n.by = mix3(n.cy, n.sy, n.oy, e, g);
      n.bz = mix3(n.cz, n.sz, n.oz * spc - n.ox * sps, e, g);
      if (arrive > 0) {
        /* Staggered by moving each node's START, not by adding to its
           progress: an additive stagger left the late nodes 3% scattered
           when `arrive` reached 0, and the heart's rim never quite closed.
           Here every node is fully out at arrive=1 and exactly home at 0;
           low-delay nodes just get there first. */
        var lead = (1 - n.delay) * 0.35;
        var q = Math.max(0, (arrive - lead) / (1 - lead));
        // ease-in on the scatter amount = the node covers most of the distance
        // early and decelerates into place: arriving, not starting up
        var ar = q * q * Math.sqrt(q);
        n.bx += (n.ax - n.bx) * ar;
        n.by += (n.ay - n.by) * ar;
        n.bz += (n.az - n.bz) * ar;
      }
      var dx = n.bx - cbx, dy = n.by - cby, dz = n.bz - cbz;
      var dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      n.d = dd;
      if (dd > maxD) maxD = dd;
    }

    view.maxD = maxD;
    var p = phaseNow(), waveK = WAVE / maxD;
    for (var q = 0; q < nodes.length; q++) {
      nodes[q].act = envelope(p - nodes[q].d * waveK);
    }

    for (var s = sigN - 1; s >= 0; s--) {
      var sg = signals[s];
      sg.t += sg.speed * dt;
      if (sg.t < 1) continue;
      var to = sg.to, from = sg.from;
      sigN--;                                  // swap the spent packet to the
      if (s !== sigN) {                        // tail rather than splicing, so
        signals[s] = signals[sigN];            // the object survives to be
        signals[sigN] = sg;                    // handed straight back out
      }
      if (Math.random() < 0.86) relay(to, from);
    }

    // the sheet gets a slight scroll-driven yaw; the sphere no longer needs one
    // here, its own spin shows the volume
    rotY += ((spread * 0.12 + tiltTY) - rotY) * approach(dt, 420);
    tiltX += (tiltTX - tiltX) * approach(dt, 380);
    tiltY += (tiltTY - tiltY) * approach(dt, 380);
  }

  // The hero reserves an empty band below the copy — the place a product shot
  // would go on an Apple page. Put the core in the middle of it.
  /* This used to call getBoundingClientRect every 500ms from inside the frame.
     Two rects mid-animation force the browser to flush layout right then, which
     costs nothing on average and everything on the frame it lands in: a hitch
     twice a second, which is what the eye reads as stutter. The band is
     measured in document space when the layout actually changes instead, and
     the frame only subtracts the scroll position. */
  var bandDoc = 0, bandH = 0, bandOK = false, marks = [];
  function measureBand() {
    var copy = document.querySelector(".warn") || document.querySelector(".acts");
    var strip = document.querySelector(".strip");
    if (!copy || !strip) { bandOK = false; return; }
    var sy = window.pageYOffset || 0;
    var a = copy.getBoundingClientRect().bottom + sy;
    var b = strip.getBoundingClientRect().top + sy;
    if (b > a) { bandDoc = (a + b) / 2; bandH = b - a; bandOK = true; }

    // where each stage's section starts, in document space
    marks.length = 0;
    for (var i = 0; i < STAGE_IDS.length; i++) {
      var el = document.getElementById(STAGE_IDS[i]);
      marks.push(el ? el.getBoundingClientRect().top + sy : 1e9);
    }
  }

  /* Walks the track and returns the state for a scroll position. One shared
     object, filled in place: this runs every frame. */
  var want = { spread: 0, orb: 0, pin: 0, dim: 1 };
  function trackAt(y) {
    var lead = h * LEAD, from = TRACK[0], prev = 0;
    for (var i = 0; i < marks.length && i + 1 < TRACK.length; i++) {
      var at = marks[i] - lead;
      if (at <= prev) at = prev + 1;
      var to = TRACK[i + 1];
      if (y < at) {
        // hold the previous state, then move into the new one over TRANS
        var span = Math.min(h * TRANS, (at - prev) * 0.7);
        var t = easeInOut(Math.max(0, Math.min(1, (y - (at - span)) / span)));
        want.spread = from.spread + (to.spread - from.spread) * t;
        want.orb = from.orb + (to.orb - from.orb) * t;
        want.pin = from.pin + (to.pin - from.pin) * t;
        want.dim = from.dim + (to.dim - from.dim) * t;
        return want;
      }
      prev = at; from = to;
    }
    want.spread = from.spread; want.orb = from.orb;
    want.pin = from.pin; want.dim = from.dim;
    return want;
  }
  var bandRO = null;
  function watchBand() {
    measureBand();
    if (typeof ResizeObserver === "function") {
      var hero = document.querySelector(".hero");
      if (hero && !bandRO) {
        bandRO = new ResizeObserver(measureBand);
        bandRO.observe(hero);
        // the ledger fills in from the summary and changes the page height,
        // which the hero alone would never report
        if (document.body) bandRO.observe(document.body);
        return;
      }
    }
    setTimeout(measureBand, 400);
    setTimeout(measureBand, 1600);
  }
  function coreBandY() {
    if (!bandOK) { bandH = h * 0.4; return h * 0.5; }
    return bandDoc - scrollY;                  // raw; dockY() bounds it
  }

  /* The dock. Traced against the scroll, the old hero->02 hand-over was a V:
     the heart rode up with the copy (slope -1), hit a clamp at 22% and stopped
     dead, then `pin` dragged it back DOWN to the centre at 1.2x scroll speed
     while the page kept going up, and only then did it settle. A reversal
     with a kink in it, right where the reader has just started scrolling --
     that is what "the first screen stutters, then it is smooth" was. Frame
     times were clean the whole way; the path was the problem.

     Now the heart rides up with the copy and eases to a stop at the centre
     of the viewport, which is where 02 wants it anyway: a soft maximum
     (softplus) instead of a clamp, so the slope goes -1 -> 0 over ~150px
     with no corner. Once docked, the pin blend is a no-op. `docking` (1 at
     the top, 0 once parked) also drives the fade, so settling and dimming
     are one gesture. */
  var docking = 1;
  function softplus(x) { return x > 30 ? x : Math.log(1 + Math.exp(x)); }
  function dockY(y) {
    if (!bandOK) { docking = 1; return y; }
    var dock = h * 0.5, soft = h * 0.07;
    var out = dock + soft * softplus((y - dock) / soft);
    // normalised by the same curve at scroll 0, so it is exactly 1 at the top
    // and follows the softplus tail down; the bottom bound below is applied
    // afterwards and cannot dim the heart while the page is still at rest
    var y0 = bandDoc - (wide ? 0 : bandH * 0.08);
    var start = Math.max(40, soft * softplus((y0 - dock) / soft));
    docking = Math.max(0, Math.min(1, (out - dock) / start));
    return out > h * 0.68 ? h * 0.68 : out;   // a short viewport: keep it on screen
  }

  function project() {
    /* On a phone the heart read as sitting low in its band: the cleft at the
       top is empty space, the point at the bottom has almost no mass, so a
       geometrically centred heart leaves a gap above and nearly touches the
       strip below. Lifted by 8% of the band while it is a heart; the lift
       fades out with `pin` as the net takes over. */
    var cy0 = dockY(coreBandY() - (wide ? 0 : bandH * 0.08) * (1 - pin));
    // While balled up the knot has to sit inside its band, not spill into the
    // readout below it; once it opens it takes the whole viewport as before.
    // on a phone the viewport is much taller than it is wide, so the opened
    // net has to be sized off the height or it only fills a middle band
    var full = wide ? Math.min(w, h * 1.5) * 0.98 : Math.max(w * 1.05, h * 0.94);
    // the collapsed heart is bound by its band and by the viewport width,
    // never by the opened size — those are two different jobs
    var packed = Math.max(240, Math.min(bandH * 1.85, w * 1.35));
    var sheet = packed + (full - packed) * Math.min(1, spread * 1.6);
    // gathered up it reads as an object, so it wants to be smaller than the
    // sheet that filled the viewport
    var scale = sheet + (full * 0.78 - sheet) * orb;
    /* On a wide screen the text column leaves ~360px of margin either side, so
       the sphere can sit half out of frame there. A phone has no "beside" --
       the column is the whole width -- so there it stays centred and just
       gathers, which actually puts less ink behind the text than the spread
       sheet did. */
    /* Centred on the right edge: half the sphere in frame, which is the
       amount that reads as a sphere rather than a sliver. Keeping it off the
       copy is the prose measure's job (bodies held to 960px, left-aligned);
       what remains is a few pixels against the ragged right edge of the
       right-hand card, dimmed to 0.42. */
    var cx = w * 0.5 + (wide ? w * 0.5 : 0) * orb;
    // position is driven by pin, not by shape: across 02 the net has to stay a
    // small heart and still follow the viewport
    var cy = cy0 + (h * 0.5 - cy0) * pin;
    var cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    var cosX = Math.cos(tiltX * 0.5), sinX = Math.sin(tiltX * 0.5);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var x1 = n.bx * cosY + n.bz * sinY;
      var z1 = -n.bx * sinY + n.bz * cosY;
      var y1 = n.by * cosX - z1 * sinX;
      var z2 = n.by * sinX + z1 * cosX;
      var persp = 2.4 / (2.4 + z2);
      n.x = cx + x1 * scale * persp;
      n.y = cy + y1 * scale * 0.94 * persp;
      n.s = persp;
    }
    view.cx = cx; view.cy = cy; view.scale = scale;
  }

  /* ---------- colour ramps and batching ----------

     Every trace, via and node used to set its own colour and submit its own
     path: around 520 beginPath/stroke pairs a frame while the net is balled up,
     each one building an "rgba(...)" string that the browser then had to parse
     as CSS. Both costs scale with the node count, and both arrive as uneven
     frame times rather than an even slowdown -- which is what reads as stutter.

     Alpha is quantised onto a logarithmic ramp instead, so each step is a fixed
     *proportion* of the value rather than a fixed amount; the eye judges
     brightness the same way. Everything landing in one bucket shares one
     pre-built colour string and one path. A fixed per-element dither breaks the
     bucket edges up spatially -- without it the pulse front, which is a smooth
     radial gradient, would quantise into visible rings. */
  var SLOT = 65;                    // room for the widest ramp, plus bucket 0
  function makeRamp(top, n) {
    var lo = 0.004, a = new Float32Array(n + 1);
    a[0] = 0;
    for (var i = 1; i <= n; i++) a[i] = lo * Math.pow(top / lo, (i - 1) / (n - 1));
    return { top: top, lo: lo, n: n, k: (n - 1) / Math.log(top / lo), a: a, c: {} };
  }
  /* Traces sit low and form a dense continuous field, so they are dithered: the
     step can be coarse as long as its edges are scattered. Node fills are
     discrete squares -- no continuous gradient means no banding to break up,
     and dithering there would only add shimmer -- so they are not dithered and
     get a finer ramp instead, which halves their error outright. */
  var RAMP_LINE = makeRamp(0.52, 32);
  var RAMP_FILL = makeRamp(1.0, 64);
  function bucket(ramp, v, jit) {
    if (v <= ramp.lo) return 0;
    if (v >= ramp.top) return ramp.n;
    var i = Math.round(Math.log(v / ramp.lo) * ramp.k + jit) + 1;
    return i < 1 ? 1 : i > ramp.n ? ramp.n : i;
  }
  function colours(ramp, name, key) {
    var byState = ramp.c[name] || (ramp.c[name] = {});
    var list = byState[key];
    if (!list) {
      list = byState[key] = new Array(ramp.n + 1);
      var rgb = (PAL[name] || PAL.idle)[key];
      for (var i = 0; i <= ramp.n; i++) list[i] = rgba(rgb, ramp.a[i]);
    }
    return list;
  }

  /* line classes, drawn in this order; vias only belong on real traces */
  var L_SOFT = 0, L_TRACE = 1, L_HOT = 2, L_TRAIL = 3, L_N = 4;
  var L_KEY = ["link", "link", "sig", "sig"];
  var L_VIA = [0, 1, 1, 0];
  /* rect classes: haloes first so no node dot ends up buried under one */
  var R_HALO = 0, R_NODE = 1, R_HOT = 2, R_N = 3;
  var R_KEY = ["sig", "node", "sig"];

  var segXY, segSlot, segCount, segCap = 0, segN = 0, viaIdx;
  var rectXY, rectSlot, rectCount, rectCap = 0, rectN = 0;
  var jitE, jitT, jitB, jitN;

  function allocBatches() {
    segCap = edges.length + tangle.length + bus.length + MAX_SIGNALS * 3 + 8;
    segXY = new Float32Array(segCap * 8);
    segSlot = new Uint16Array(segCap);
    viaIdx = new Int32Array(segCap);
    segCount = new Uint16Array(L_N * SLOT);
    rectCap = nodes.length * 2 + MAX_SIGNALS + 8;
    rectXY = new Float32Array(rectCap * 3);
    rectSlot = new Uint16Array(rectCap);
    rectCount = new Uint16Array(R_N * SLOT);
    // dither offsets, seeded so the picture is identical from run to run
    var rnd = mulberry32(SEED ^ 0x5bd1);
    jitE = new Float32Array(edges.length);
    for (var i = 0; i < edges.length; i++) jitE[i] = rnd() - 0.5;
    jitT = new Float32Array(tangle.length);
    for (i = 0; i < tangle.length; i++) jitT[i] = rnd() - 0.5;
    jitB = new Float32Array(bus.length);
    for (i = 0; i < bus.length; i++) jitB[i] = rnd() - 0.5;
    jitN = new Float32Array(nodes.length);
    for (i = 0; i < nodes.length; i++) jitN[i] = rnd() - 0.5;
  }

  function pushRoute(cls, b) {            // the four points currently in route
    if (segN >= segCap) return;
    var o = segN * 8;
    segXY[o] = route[0]; segXY[o + 1] = route[1];
    segXY[o + 2] = route[2]; segXY[o + 3] = route[3];
    segXY[o + 4] = route[4]; segXY[o + 5] = route[5];
    segXY[o + 6] = route[6]; segXY[o + 7] = route[7];
    var slot = cls * SLOT + b;
    segSlot[segN++] = slot; segCount[slot]++;
  }
  function pushLine(cls, b, ax, ay, bx, by) {   // stored as a flat polyline
    if (segN >= segCap) return;
    var o = segN * 8;
    segXY[o] = ax; segXY[o + 1] = ay; segXY[o + 2] = ax; segXY[o + 3] = ay;
    segXY[o + 4] = bx; segXY[o + 5] = by; segXY[o + 6] = bx; segXY[o + 7] = by;
    var slot = cls * SLOT + b;
    segSlot[segN++] = slot; segCount[slot]++;
  }
  function pushRect(cls, b, x, y, size) {
    if (rectN >= rectCap) return;
    var o = rectN * 3;
    rectXY[o] = x; rectXY[o + 1] = y; rectXY[o + 2] = size;
    var slot = cls * SLOT + b;
    rectSlot[rectN++] = slot; rectCount[slot]++;
  }

  /* A via is a 1.6x1.6px pad at each elbow, drawn one ramp step below its own
     trace. Below about 10% alpha on this background that is a pixel or two of
     difference nobody can see -- but it was still 376 of the 482 via fills a
     frame, and fills were the single largest call category left (610 a frame,
     79% of them vias). Dim traces lose their pads; the pulse front keeps them,
     so the pads now light up as the wave passes instead of speckling evenly. */
  var VIA_MIN = 0.10;

  function flushSegs(name) {
    for (var cls = 0; cls < L_N; cls++) {
      var cols = colours(RAMP_LINE, name, L_KEY[cls]);
      var via = L_VIA[cls];
      if (cls === L_TRAIL) ctx.lineWidth = 1.4;
      for (var b = 1; b <= RAMP_LINE.n; b++) {
        var slot = cls * SLOT + b;
        if (!segCount[slot]) continue;
        // decided once per bucket, so dim buckets skip the bookkeeping too
        var wantVia = via && RAMP_LINE.a[b] >= VIA_MIN;
        var nv = 0;
        ctx.beginPath();
        for (var i = 0; i < segN; i++) {
          if (segSlot[i] !== slot) continue;
          var o = i * 8;
          ctx.moveTo(segXY[o], segXY[o + 1]);
          ctx.lineTo(segXY[o + 2], segXY[o + 3]);
          ctx.lineTo(segXY[o + 4], segXY[o + 5]);
          ctx.lineTo(segXY[o + 6], segXY[o + 7]);
          if (wantVia) viaIdx[nv++] = o;
        }
        ctx.strokeStyle = cols[b];
        ctx.stroke();
        if (!nv) continue;
        ctx.fillStyle = cols[b > 1 ? b - 1 : 1];   // one ramp step down, about x0.85
        for (var v = 0; v < nv; v++) {
          var q = viaIdx[v];
          ctx.fillRect(segXY[q + 2] - 0.8, segXY[q + 3] - 0.8, 1.6, 1.6);
          ctx.fillRect(segXY[q + 4] - 0.8, segXY[q + 5] - 0.8, 1.6, 1.6);
        }
      }
      if (cls === L_TRAIL) ctx.lineWidth = 1;
    }
  }

  function flushRects(name) {
    for (var cls = 0; cls < R_N; cls++) {
      var cols = colours(RAMP_FILL, name, R_KEY[cls]);
      for (var b = 1; b <= RAMP_FILL.n; b++) {
        var slot = cls * SLOT + b;
        if (!rectCount[slot]) continue;
        ctx.fillStyle = cols[b];
        for (var i = 0; i < rectN; i++) {
          if (rectSlot[i] !== slot) continue;
          var o = i * 3, sz = rectXY[o + 2];
          ctx.fillRect(rectXY[o], rectXY[o + 1], sz, sz);
        }
      }
    }
  }

  /* ---------- circuit-trace routing: run, 45-degree elbow, run ---------- */
  var route = [0, 0, 0, 0, 0, 0, 0, 0];
  function routeTrace(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    var sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    route[0] = ax; route[1] = ay;
    if (adx > ady) {
      var run = (adx - ady) / 2;
      route[2] = ax + sx * run;       route[3] = ay;
      route[4] = ax + sx * (run + ady); route[5] = ay + sy * ady;
    } else {
      var rise = (ady - adx) / 2;
      route[2] = ax;                  route[3] = ay + sy * rise;
      route[4] = ax + sx * adx;       route[5] = ay + sy * (rise + adx);
    }
    route[6] = bx; route[7] = by;
  }
  /* a point at t along the routed trace, so packets follow the trace and not a
     chord. The three leg lengths are measured once per trace instead of once
     per sample, and Math.hypot -- which guards against an overflow screen
     coordinates cannot produce -- gives way to a plain square root. */
  var rl1 = 0, rl2 = 0, rl3 = 0, rtot = 1;
  function measureRoute() {
    var ax = route[2] - route[0], ay = route[3] - route[1];
    var bx = route[4] - route[2], by = route[5] - route[3];
    var cx = route[6] - route[4], cy = route[7] - route[5];
    rl1 = Math.sqrt(ax * ax + ay * ay);
    rl2 = Math.sqrt(bx * bx + by * by);
    rl3 = Math.sqrt(cx * cx + cy * cy);
    rtot = rl1 + rl2 + rl3 || 1;
  }
  function alongTrace(t, out) {
    var d = t * rtot, i = 0, seg = rl1;
    if (d > rl1) { d -= rl1; i = 2; seg = rl2; if (d > rl2) { d -= rl2; i = 4; seg = rl3; } }
    var k = seg ? d / seg : 0;
    out[0] = route[i] + (route[i + 2] - route[i]) * k;
    out[1] = route[i + 1] + (route[i + 3] - route[i + 1]) * k;
  }

  /* ---------- drawing ---------- */
  var pt = [0, 0], pt2 = [0, 0], pt3 = [0, 0];
  function draw() {
    var name = PAL[state] ? state : "idle";
    var pal = PAL[name];
    var boost = extra > 0 ? 0.5 : 0;
    // brightness is a keyframed value now, so how loud the net is at any point
    // is a decision about that section rather than a by-product of its shape
    ctx.clearRect(0, 0, w, h);
    project();
    // while it is a heart the brightness follows the docking -- it fades as it
    // settles; from 03 on the keyframe alone decides
    // ^0.7: stays bright while the copy is still on screen, is down to ~0.28
    // by the time the readout strip and the 02 title cross it
    var dockFade = 0.2 + 0.8 * Math.pow(docking, 0.7);
    var dimEff = Math.min(dim, dockFade + (1 - dockFade) * spread);
    var gain = (wide ? 0.96 : 0.58) * dimEff;
    if (layer) {
      view.w = w; view.h = h; view.dpr = dpr; view.wide = wide;
      view.spread = spread; view.orb = orb; view.arrive = arrive;
      view.rotY = rotY; view.tiltX = tiltX; view.spin = spin;
      view.gain = gain; view.phase = phaseNow(); view.clock = clock;
      view.pal = pal; view.reduced = reduced;
      layer(view);
    }
    ctx.lineCap = "square";
    ctx.lineJoin = "miter";
    ctx.lineWidth = 1;

    /* The backlight. Apple lights the product; this lights the heart. A wide,
       soft pool of the core colour drawn UNDER the traces separates the mark
       from the black and reads as illumination rather than paint. It follows
       the heart into its other shapes at reduced strength. */
    drawBacklight(name, gain);

    segN = 0; rectN = 0;
    segCount.fill(0); rectCount.fill(0);

    var knot = Math.max(0, 1 - spread * 1.6);
    if (knot > 0.01) {
      for (var g2 = 0; g2 < tangle.length; g2++) {
        var ta = nodes[tangle[g2].a], tb = nodes[tangle[g2].b];
        var tl = (ta.act + tb.act) / 2;
        var tk = bucket(RAMP_LINE, (0.045 + tl * 0.12) * knot * gain, jitT[g2]);
        if (!tk) continue;
        routeTrace(ta.x, ta.y, tb.x, tb.y);
        pushRoute(L_SOFT, tk);
      }
    }

    for (var u2 = 0; u2 < bus.length; u2++) {
      var ba = nodes[bus[u2].a], bb = nodes[bus[u2].b];
      var bl = (ba.act + bb.act) / 2;
      var uk = bucket(RAMP_LINE, (0.035 + bl * 0.10) * gain, jitB[u2]);
      if (!uk) continue;
      routeTrace(ba.x, ba.y, bb.x, bb.y);
      pushRoute(L_SOFT, uk);
    }

    for (var e = 0; e < edges.length; e++) {
      var a = nodes[edges[e].a], b = nodes[edges[e].b];
      var depth = (a.s + b.s) / 2;
      var live = (a.act + b.act) / 2;
      var ek = bucket(RAMP_LINE,
        (0.05 + (depth - 0.88) * 0.3 + live * 0.22 + boost * 0.06) * gain, jitE[e]);
      if (!ek) continue;
      routeTrace(a.x, a.y, b.x, b.y);
      pushRoute(live > 0.4 ? L_HOT : L_TRACE, ek);
    }

    // nodes: squares on the lattice
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var near = 0;
      if (pointer.on) {
        var dx = n.x - pointer.x, dy = n.y - pointer.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 20000) near = 1 - Math.sqrt(d2) / 142;
      }
      var hot = n.act + near * 0.7 + boost;
      var r = n.size * n.s * (0.85 + hot * 0.5);
      var jn = jitN[i];
      if (hot > 0.25) {
        var hk = bucket(RAMP_FILL, Math.min(0.2, (hot - 0.25) * 0.16) * gain, jn);
        if (hk) pushRect(R_HALO, hk, n.x - r * 2.6, n.y - r * 2.6, r * 5.2);
      }
      var nk = bucket(RAMP_FILL, (0.16 + (n.s - 0.86) * 0.7 + hot * 0.45) * gain, 0);
      if (nk) pushRect(hot > 0.35 ? R_HOT : R_NODE, nk,
        Math.round(n.x - r / 2), Math.round(n.y - r / 2), Math.max(1, Math.round(r)));
    }

    // packets running the traces, always forward
    for (var si = 0; si < sigN; si++) {
      var sg = signals[si];
      var f = nodes[sg.from], t = nodes[sg.to];
      if (!f || !t) continue;
      routeTrace(f.x, f.y, t.x, t.y);
      measureRoute();
      // cap the trail in pixels: once the net opens the traces get long, and a
      // fixed fraction would stretch each packet into a streak
      var span = Math.abs(t.x - f.x) + Math.abs(t.y - f.y);
      var tail = Math.min(0.34, 66 / Math.max(1, span));
      // the comet head used to be a fresh linear gradient per packet. Three
      // straight pieces at rising alpha read the same from a metre away and
      // batch with everything else instead of allocating thirty gradients.
      for (var q = 0; q < 3; q++) {
        var t0 = sg.t - tail * (3 - q) / 3;
        var t1 = sg.t - tail * (2 - q) / 3;
        if (t0 < 0) t0 = 0;
        if (t1 <= t0) continue;
        alongTrace(t0, pt2);
        alongTrace(t1, pt3);
        var qk = bucket(RAMP_LINE, (0.10 + q * 0.26) * gain, 0);
        if (qk) pushLine(L_TRAIL, qk, pt2[0], pt2[1], pt3[0], pt3[1]);
      }
      alongTrace(sg.t, pt);
      var pk = bucket(RAMP_FILL, 0.85 * gain, 0);
      if (pk) pushRect(R_HOT, pk, pt[0] - 1.6, pt[1] - 1.6, 3.2);
    }

    flushSegs(name);
    flushRects(name);

    // the mesh stays quiet on a phone; the core does not
    drawCore(name, pal, wide ? gain : gain * 1.9);
    if (spread > 0.12) punchHole();
  }

  /* The core halo was a radial gradient rebuilt every single frame. It is the
     same shape every time, so it is rendered once per palette into an offscreen
     canvas and scaled in with drawImage; only its opacity changes per frame. */
  var glowCache = {};
  function glowSprite(name) {
    var cv = glowCache[name];
    if (cv) return cv;
    cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    var g2 = cv.getContext("2d");
    var g = g2.createRadialGradient(128, 128, 0, 128, 128, 128);
    var rgb = (PAL[name] || PAL.idle).core;
    g.addColorStop(0, rgba(rgb, 1));
    g.addColorStop(1, rgba(rgb, 0));
    g2.fillStyle = g;
    g2.fillRect(0, 0, 256, 256);
    glowCache[name] = cv;
    return cv;
  }

  function drawBacklight(name, gain) {
    var c = nodes[heartId];
    if (!c) return;
    var r = wide ? 12 : 10;
    var ga = 0.11 * gain * (1 - spread * 0.55) * (1 - orb * 0.4);
    if (ga <= 0.004) return;
    ctx.globalAlpha = ga;
    ctx.drawImage(glowSprite(name), c.x - r * 30, c.y - r * 30, r * 60, r * 60);
    ctx.globalAlpha = 1;
  }

  function drawCore(name, pal, gain) {
    var c = nodes[heartId];
    if (!c) return;
    var beat = c.act;
    var r = (wide ? 10 : 9.5) + beat * (wide ? 7 : 6.5);

    var ga = (0.22 + beat * 0.34) * gain;
    if (ga > 0.003) {
      ctx.globalAlpha = ga > 1 ? 1 : ga;
      ctx.drawImage(glowSprite(name), c.x - r * 10, c.y - r * 10, r * 20, r * 20);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = rgba(pal.core, Math.min(1, (0.62 + beat * 0.38) * gain));
    var box = r * 0.78;
    ctx.fillRect(Math.round(c.x - box / 2), Math.round(c.y - box / 2),
      Math.round(box), Math.round(box));

    // a square bracket around the core, stepping out on each cycle
    var p = phaseNow();
    var reach = Math.min(w, h) * (0.05 + 0.26 * (0.4 + spread * 0.6));
    var ring = r * 2 + p * reach;
    ctx.strokeStyle = rgba(pal.core, 0.18 * Math.pow(1 - p, 2.2) * gain);
    ctx.strokeRect(c.x - ring, c.y - ring * 0.8, ring * 2, ring * 1.6);
  }

  /* Same story as the halo: one gradient, one arc fill and a save/restore pair
     every frame, all to punch the same soft hole. Baked into a sprite instead,
     since only the strength of the hole changes as the net opens. */
  var holeSprite = null;
  function makeHole() {
    holeSprite = document.createElement("canvas");
    holeSprite.width = holeSprite.height = 512;
    var g2 = holeSprite.getContext("2d");
    var g = g2.createRadialGradient(256, 256, 0, 256, 256, 256);
    g.addColorStop(0, "rgba(0,0,0,0.54)");
    g.addColorStop(0.55, "rgba(0,0,0,0.38)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    g2.fillStyle = g;
    g2.fillRect(0, 0, 512, 512);
  }
  function punchHole() {
    // the hole exists to keep the copy readable through the net; once the net
    // has gathered and moved aside there is nothing left to hold back
    var k = Math.min(1, (spread - 0.12) / 0.5) * (wide ? 1 - orb * 0.85 : 1);
    if (k <= 0.004) return;
    if (!holeSprite) makeHole();
    var rx = wide ? w * 0.38 : w * 0.62;
    var ry = rx * (wide ? 0.72 : 1.05);
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = k;
    ctx.drawImage(holeSprite, w * 0.5 - rx, h * 0.5 - ry, rx * 2, ry * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* ---------- loop ---------- */
  var pending = 0;
  function frame(now) {
    if (!running) return;
    var dt = Math.min(48, now - (last || now));
    last = now;
    step(dt);
    draw();
    pending = requestAnimationFrame(frame);
  }
  function play() { if (reduced || running) return; running = true; last = 0; pending = requestAnimationFrame(frame); }
  function pause() { running = false; }

  /* The wheel scroller in app.js writes the scroll position from its own
     animation frame. Frame callbacks run in the order they were registered,
     and this loop is always the older registration -- so for the whole of a
     glide it read the position from the frame BEFORE the scroller moved it.
     Anything anchored to the document, which at the top of the page is the
     heart, trailed the copy by one frame: 5-10px at speed, measured, and it
     reads as the first screen stuttering while the rest of the page (where
     the net is pinned to the viewport) looks fine. The scroller calls this
     when it starts and the loop moves behind it in the frame order. */
  window.coreYield = function () {
    if (!running || !pending) return;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(frame);
  };

  /* ---------- input ---------- */
  if (!reduced) {
    window.addEventListener("pointermove", function (ev) {
      pointer.x = ev.clientX; pointer.y = ev.clientY; pointer.on = true;
      tiltTY = ((ev.clientX / Math.max(1, w)) - 0.5) * 0.18;
      tiltTX = ((ev.clientY / Math.max(1, h)) - 0.5) * 0.16;
    }, { passive: true });
    window.addEventListener("pointerleave", function () { pointer.on = false; }, { passive: true });
    window.addEventListener("pointerdown", function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest("a, button, input, table")) return;
      extra = 520;
      fire(6);
    }, { passive: true });
  }

  window.addEventListener("resize", function () { resize(); if (reduced) draw(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) pause(); else play();
  });

  /* The net used to paint in its default palette from the first frame and hard
     cut to the real one when the summary landed -- a stretch of silver, then a
     jump to gold, as long as the round trip takes. It now stays dark until it
     has been told the state, then fades in already correct. A later change of
     state dips and comes back, so a run that halts while someone is reading is
     visible rather than a jump cut. */
  var revealed = false, swapTimer = 0;
  function reveal() {
    if (revealed) return;
    revealed = true;
    /* The one moment that gets remembered: the net is not simply there, it
       ARRIVES -- a loose cloud, the core already lit, drawing in to the heart
       over 1.4s while the type rises beside it. It is the scroll morph run
       backwards, so it costs one lerp per node for 1.4s and nothing after,
       and it foreshadows what the scroll will do. Off under reduced motion. */
    if (!reduced) arrive = 1;
    canvas.classList.add("is-lit");
  }
  setTimeout(reveal, 1200);    // a summary that never arrives must not leave the hero empty

  window.setCoreState = function (next) {
    var want = PAL[next] ? next : "idle";
    if (!revealed) {
      state = want;
      reveal();
      if (reduced) draw();
      return;
    }
    if (want === state) return;          // the summary is polled; most calls repeat
    if (reduced) { state = want; draw(); return; }
    clearTimeout(swapTimer);
    canvas.style.opacity = "0.16";
    swapTimer = setTimeout(function () {
      state = want;
      canvas.style.opacity = "";         // back to whatever .is-lit says
    }, 400);
  };
  window.corePulse = function () { if (!reduced) { extra = 520; fire(5); } };

  view.HOLD = HOLD; view.ORB_R = ORB_R; view.WAVE = WAVE; view.HEART = HEART;
  window.coreLayer = function (fn) { layer = fn; if (reduced && fn) draw(); };
  if (me && me.src && /[?&]gl=1(?:&|#|$)/.test(location.search)) {
    var extraLayer = document.createElement("script");
    extraLayer.src = me.src.replace(/core\.js(\?.*)?$/, "core-gl.js");
    document.head.appendChild(extraLayer);
  }

  resize();
  watchBand();
  window.addEventListener("load", measureBand);
  if (reduced) {
    clock = CYCLE_MS * 0.02;
    var k0 = trackAt(window.pageYOffset || 0);
    spread = k0.spread; orb = k0.orb; pin = k0.pin; dim = k0.dim;
    step(0);
    draw();
  } else {
    play();
  }
})();
