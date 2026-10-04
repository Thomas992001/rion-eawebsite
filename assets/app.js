/* Showcase page — reads one sanitised status file and renders it.
   Bilingual: the string table is picked from <html lang>.
   No backend, no cookies, no third-party scripts. If the file cannot be
   fetched, the last cached copy is shown with a clear "cannot update" notice. */
(function () {
  "use strict";

  var STATUS_URL = document.documentElement.getAttribute("data-status") || "data/status.json";
  var CACHE_KEY = "rionea99.status.cache";
  var REFRESH_MS = 60000;
  var STALE_MINUTES = 30;
  var LOST_MINUTES = 15;   // no heartbeat for this long: the page says so itself
  var NS = "http://www.w3.org/2000/svg";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var STRINGS = {
    zh: {
      src: { LIVE: "LIVE 真实账户", DEMO: "DEMO 演示数据", BACKTEST: "BACKTEST 回测", unknown: "来源未知" },
      state: { online: "运行中", idle: "休眠", halted: "已暂停", lost: "失联", offline: "无法连接" },
      min: " 分钟", hour: " 小时", minShort: " 分",
      justNow: "刚刚", minsAgo: " 分钟前", hoursAgo: " 小时前", daysAgo: " 天前",
      updated: "更新于 ", stale: "数据可能已过期 · ", cached: "暂时无法更新，显示上次缓存",
      unavailable: "暂时无法取得数据",
      equity: "净值 ", fromPeak: "自高点回落 ", trades: " 笔", points: " 点",
      noTrades: "暂无已平仓记录",
      generated: "摘要生成于 ", brokerPending: "策略页链接将在提供者账户开通后填入。",
      curveTable: "净值曲线数据（等距抽样）", curveDate: "日期", curveValue: "净值",
      curveFrom: "净值曲线，起点 ", curveTo: "，终点 ", curveLow: "，期间最低 ", curveHigh: "，最高 "
    },
    en: {
      src: { LIVE: "LIVE ACCOUNT", DEMO: "DEMO DATA", BACKTEST: "BACKTEST", unknown: "SOURCE UNKNOWN" },
      state: { online: "Running", idle: "Idle", halted: "Halted", lost: "No signal", offline: "No connection" },
      min: " min", hour: " h", minShort: " min",
      justNow: "just now", minsAgo: " min ago", hoursAgo: " h ago", daysAgo: " d ago",
      updated: "Updated ", stale: "Possibly stale · ", cached: "Cannot update; showing last cached copy",
      unavailable: "Data unavailable",
      equity: "Equity ", fromPeak: "From peak ", trades: " trades", points: " pts",
      noTrades: "No closed trades yet",
      generated: "Summary generated ", brokerPending: "The strategy page link will be added once the provider account is open.",
      curveTable: "Equity curve data (evenly sampled)", curveDate: "Date", curveValue: "Equity",
      curveFrom: "Equity curve, from ", curveTo: " to ", curveLow: ", low ", curveHigh: ", high "
    }
  };
  var T = STRINGS[(document.documentElement.lang || "zh").slice(0, 2) === "en" ? "en" : "zh"];

  var SOURCE_CLASS = { LIVE: "is-live", DEMO: "is-demo", BACKTEST: "is-backtest" };
  var STATE_CLASS = { online: "is-online", idle: "is-idle", halted: "is-halted", lost: "is-lost" };

  function $(id) { return document.getElementById(id); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }

  /* ---------- formatting ---------- */
  function pct(v, signed) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var s = Math.abs(v).toFixed(2) + "%";
    if (!signed) return s;
    if (v > 0) return "+" + s;
    if (v < 0) return "−" + s;
    return s;
  }
  function minutesText(m) {
    if (m === null || m === undefined || isNaN(m)) return "—";
    m = Math.round(m);
    if (m < 60) return m + T.min;
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + T.hour + " " + r + T.minShort : h + T.hour;
  }
  function agoText(iso) {
    var then = Date.parse(iso);
    if (isNaN(then)) return "—";
    var mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return T.justNow;
    if (mins < 60) return mins + T.minsAgo;
    var h = Math.floor(mins / 60);
    return h < 24 ? h + T.hoursAgo : Math.floor(h / 24) + T.daysAgo;
  }
  function minutesSince(iso) {
    var then = Date.parse(iso);
    return isNaN(then) ? Infinity : (Date.now() - then) / 60000;
  }

  /* a strip value that changed gets a short gold flash, nothing else moves */
  function setStrip(id, value) {
    var el = $(id);
    if (!el) return;
    var prev = el.getAttribute("data-t");
    if (prev === value) return;
    el.setAttribute("data-t", value);
    el.textContent = value;
    // the closing strip carries the same readout under data-mirror
    var twins = document.querySelectorAll('[data-mirror="' + id + '"]');
    for (var m = 0; m < twins.length; m++) twins[m].textContent = value;
    if (prev === null || reduced) return;
    el.classList.add("is-upd");
    for (m = 0; m < twins.length; m++) twins[m].classList.add("is-upd");
    setTimeout(function () {
      el.classList.remove("is-upd");
      for (var k = 0; k < twins.length; k++) twins[k].classList.remove("is-upd");
    }, 1100);
  }

  /* ---------- counting numbers up ---------- */
  function animateNumber(id, to, format) {
    var el = $(id);
    if (!el) return;
    if (to === null || to === undefined || isNaN(to)) { el.textContent = "—"; return; }
    var from = parseFloat(el.getAttribute("data-v"));
    if (isNaN(from)) from = 0;
    el.setAttribute("data-v", to);
    // A hidden tab gets no animation frames, so never leave a half-counted number there.
    if (reduced || document.hidden || from === to) { el.textContent = format(to); return; }
    var t0 = performance.now(), dur = 900;
    (function tick(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* ---------- equity chart ---------- */
  var chart = { curve: [], slice: [], range: 0, box: { w: 0, h: 0 }, lo: 0, hi: 1, drawn: false };

  function chartGeometry() {
    var wrap = $("chartWrap"), svg = $("equityChart");
    if (!wrap || !svg) return false;
    var rect = wrap.getBoundingClientRect();
    chart.box.w = Math.max(120, Math.round(rect.width));
    chart.box.h = Math.max(120, Math.round(rect.height));
    svg.setAttribute("viewBox", "0 0 " + chart.box.w + " " + chart.box.h);
    return true;
  }
  function xAt(i) {
    var n = chart.slice.length;
    return n < 2 ? 0 : (i / (n - 1)) * chart.box.w;
  }
  function yAt(v) {
    var padT = 12, padB = 12;
    return padT + (1 - (v - chart.lo) / (chart.hi - chart.lo)) * (chart.box.h - padT - padB);
  }

  function renderChart(animate) {
    var svg = $("equityChart");
    if (!svg || !chartGeometry()) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var src = chart.curve;
    if (!src || src.length < 2) return;
    chart.slice = chart.range > 0 ? src.slice(Math.max(0, src.length - chart.range)) : src;

    var vals = chart.slice.map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1;
    chart.lo = lo - span * 0.12;
    chart.hi = hi + span * 0.12;

    var defs = document.createElementNS(NS, "defs");
    defs.innerHTML =
      '<linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#c8a350" stop-opacity="0.16"/>' +
      '<stop offset="100%" stop-color="#c8a350" stop-opacity="0"/></linearGradient>';
    svg.appendChild(defs);

    // the starting level of the visible window, as a hairline
    var base = document.createElementNS(NS, "line");
    base.setAttribute("x1", 0); base.setAttribute("x2", chart.box.w);
    base.setAttribute("y1", yAt(vals[0])); base.setAttribute("y2", yAt(vals[0]));
    base.setAttribute("stroke", "rgba(236,235,231,0.12)");
    svg.appendChild(base);

    var d = "";
    for (var i = 0; i < chart.slice.length; i++) {
      d += (i ? "L" : "M") + xAt(i).toFixed(2) + " " + yAt(chart.slice[i][1]).toFixed(2) + " ";
    }

    var fill = document.createElementNS(NS, "path");
    fill.setAttribute("d", d + "L" + chart.box.w + " " + chart.box.h + " L0 " + chart.box.h + " Z");
    fill.setAttribute("fill", "url(#eqFill)");
    svg.appendChild(fill);

    var line = document.createElementNS(NS, "path");
    line.setAttribute("d", d.trim());
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#c8a350");
    line.setAttribute("stroke-width", "1.6");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);

    if (animate && !reduced && !document.hidden && line.getTotalLength) {
      var len = line.getTotalLength();
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = len;
      line.getBoundingClientRect();
      line.style.transition = "stroke-dashoffset 1200ms cubic-bezier(.2,.7,.2,1)";
      line.style.strokeDashoffset = "0";
      fill.style.opacity = "0";
      fill.style.transition = "opacity 900ms ease 300ms";
      requestAnimationFrame(function () { fill.style.opacity = "1"; });
    }

    var last = document.createElementNS(NS, "circle");
    last.setAttribute("cx", chart.box.w - 1);
    last.setAttribute("cy", yAt(vals[vals.length - 1]));
    last.setAttribute("r", "2.6");
    last.setAttribute("fill", "#e3cf9f");
    svg.appendChild(last);

    var cross = document.createElementNS(NS, "g");
    cross.setAttribute("id", "eqCross");
    cross.setAttribute("opacity", "0");
    var cl = document.createElementNS(NS, "line");
    cl.setAttribute("y1", 0); cl.setAttribute("y2", chart.box.h);
    cl.setAttribute("stroke", "rgba(236,235,231,0.22)");
    cross.appendChild(cl);
    var cd = document.createElementNS(NS, "circle");
    cd.setAttribute("r", "3.4"); cd.setAttribute("fill", "#e3cf9f");
    cross.appendChild(cd);
    svg.appendChild(cross);

    setText("axisStart", chart.slice[0][0]);
    setText("axisEnd", chart.slice[chart.slice.length - 1][0]);
    describeChart();
  }

  /* A screen reader was told only "equity curve" and got nothing else. The six
     summary figures and the trades table are already readable, so what is
     missing is the shape of the line: an evenly sampled table gives that
     without reciting 260 points. */
  function describeChart() {
    var svg = $("equityChart"), host = $("chartTable");
    if (!svg || chart.slice.length < 2) return;

    var lo = chart.slice[0][1], hi = lo;
    for (var i = 1; i < chart.slice.length; i++) {
      var v = chart.slice[i][1];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    var first = chart.slice[0], last = chart.slice[chart.slice.length - 1];
    svg.setAttribute("aria-label",
      T.curveFrom + first[0] + " " + first[1].toFixed(2) +
      T.curveTo + last[0] + " " + last[1].toFixed(2) +
      T.curveLow + lo.toFixed(2) + T.curveHigh + hi.toFixed(2));

    if (!host) return;
    var n = chart.slice.length, want = n < 12 ? n : 12, rows = "";
    for (var k = 0; k < want; k++) {
      var idx = want === 1 ? 0 : Math.round(k * (n - 1) / (want - 1));
      rows += "<tr><td>" + chart.slice[idx][0] + "</td><td>" +
        chart.slice[idx][1].toFixed(2) + "</td></tr>";
    }
    host.innerHTML = "<table><caption>" + T.curveTable + "</caption><thead><tr><th>" +
      T.curveDate + "</th><th>" + T.curveValue + "</th></tr></thead><tbody>" +
      rows + "</tbody></table>";
  }

  function moveCrosshair(clientX) {
    var wrap = $("chartWrap"), cross = $("eqCross"), tip = $("chartTip");
    if (!wrap || !cross || !tip || chart.slice.length < 2) return;
    var rect = wrap.getBoundingClientRect();
    var rel = Math.max(0, Math.min(chart.box.w, clientX - rect.left));
    var idx = Math.max(0, Math.min(chart.slice.length - 1,
      Math.round((rel / chart.box.w) * (chart.slice.length - 1))));

    var px = xAt(idx), value = chart.slice[idx][1], py = yAt(value);
    cross.setAttribute("opacity", "1");
    cross.firstChild.setAttribute("x1", px);
    cross.firstChild.setAttribute("x2", px);
    cross.lastChild.setAttribute("cx", px);
    cross.lastChild.setAttribute("cy", py);

    var peak = 0;
    for (var i = 0; i <= idx; i++) peak = Math.max(peak, chart.slice[i][1]);
    var dd = peak > 0 ? (peak - value) / peak * 100 : 0;

    tip.hidden = false;
    tip.innerHTML =
      '<span class="tip-d">' + chart.slice[idx][0] + "</span>" +
      '<span class="tip-v">' + T.equity + value.toFixed(2) + "</span>" +
      '<span class="tip-dd">' + T.fromPeak + "−" + dd.toFixed(2) + "%</span>";
    var tw = tip.offsetWidth || 130;
    tip.style.left = Math.max(0, Math.min(chart.box.w - tw, px + 14)) + "px";
    tip.style.top = Math.max(0, Math.min(chart.box.h - tip.offsetHeight, py - 20)) + "px";
  }

  function hideCrosshair() {
    var cross = $("eqCross"), tip = $("chartTip");
    if (cross) cross.setAttribute("opacity", "0");
    if (tip) tip.hidden = true;
  }

  function wireChart() {
    var wrap = $("chartWrap");
    if (!wrap) return;
    restoreRange();
    wrap.addEventListener("pointermove", function (e) { moveCrosshair(e.clientX); }, { passive: true });
    wrap.addEventListener("pointerleave", hideCrosshair, { passive: true });
    wrap.addEventListener("pointercancel", hideCrosshair, { passive: true });
    // a finger leaves no cursor behind, so the readout has to clear on lift
    wrap.addEventListener("pointerup", function (e) {
      if (e.pointerType !== "mouse") setTimeout(hideCrosshair, 1600);
    }, { passive: true });

    var buttons = document.querySelectorAll(".seg button");
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(buttons, function (o) { o.classList.remove("is-on"); });
        b.classList.add("is-on");
        chart.range = parseInt(b.getAttribute("data-range"), 10) || 0;
        try { sessionStorage.setItem("range", String(chart.range)); } catch (e) { /* private mode */ }
        hideCrosshair();
        renderChart(true);
      });
    });

    var pending = false;
    function onResize() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; hideCrosshair(); renderChart(false); });
    }
    if ("ResizeObserver" in window) new ResizeObserver(onResize).observe(wrap);
    else window.addEventListener("resize", onResize);
  }

  /* ---------- ledger ---------- */
  function drawTrades(list) {
    var body = $("tradesBody");
    if (!body) return;
    body.innerHTML = "";
    if (!list || !list.length) {
      body.innerHTML = '<tr><td colspan="4" class="s-meta">' + T.noTrades + "</td></tr>";
      return;
    }
    list.slice(0, 6).forEach(function (t, i) {
      var tr = document.createElement("tr");
      tr.style.setProperty("--i", i);
      var pos = (t.result_points || 0) >= 0;
      tr.innerHTML =
        "<td>" + (t.closed_gmt || "").slice(0, 16).replace("T", " ") + "</td>" +
        '<td class="' + (t.side === "BUY" ? "buy" : "sell") + '">' + (t.side || "—") + "</td>" +
        "<td>" + minutesText(t.hold_minutes) + "</td>" +
        '<td class="r ' + (pos ? "pos" : "neg") + '">' +
        (pos ? "+" : "−") + Math.abs(t.result_points).toFixed(1) + T.points + "</td>";
      body.appendChild(tr);
    });
  }

  /* ---------- reveal ---------- */
  function wireReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduced) {
      window.__revealReady = true;
      Array.prototype.forEach.call(items, function (el) { el.classList.add("is-in"); });
      return;
    }
    window.__revealReady = true;   // the inline fallback in <head> checks this
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        io.unobserve(en.target);
        if (en.target.id === "performance") renderChart(true);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    Array.prototype.forEach.call(items, function (el) { io.observe(el); });
  }

  /* ---------- render ---------- */
  var lastData = null, lastOffline = false, seenByVisitor = false;

  function loaded() { document.documentElement.classList.remove("is-loading"); }
  // if no path below ever fires -- a fetch that neither resolves nor rejects
  // -- the dashes must still come back rather than skeletons breathing forever
  setTimeout(loaded, 8000);

  function render(data, offline) {
    lastData = data; lastOffline = offline;
    loaded();
    if (!document.hidden) seenByVisitor = true;

    var src = (data.source || "").toUpperCase();
    var label = T.src[src] || T.src.unknown;
    ["sourceBadge", "sourceBadge2"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = label;
      el.className = "src " + (SOURCE_CLASS[src] || "");
    });

    // Never take the file's word for "running": if the heartbeat has stopped,
    // the file is simply frozen and would keep claiming the system is alive.
    var st = data.state || (data.online ? "online" : "idle");
    if (minutesSince(data.last_heartbeat_gmt) > LOST_MINUTES) st = "lost";
    var stateText = T.state[st] || T.state.idle;
    var dotClass = "dot " + (STATE_CLASS[st] || "is-idle");
    var dot = $("stateDot");
    if (dot) dot.className = dotClass;
    var dots = document.querySelectorAll('[data-mirror="stateDot"]');
    for (var d = 0; d < dots.length; d++) dots[d].className = dotClass;
    setText("stateText", stateText);
    if (window.setCoreState) window.setCoreState(st === "lost" ? "idle" : st);
    if (window.corePulse && !offline) window.corePulse();

    var stale = minutesSince(data.generated_gmt) > STALE_MINUTES;
    setText("updatedAgo",
      offline ? T.cached : (stale ? T.stale : T.updated) + agoText(data.generated_gmt));

    setStrip("teleState", stateText);
    setStrip("teleBeat", agoText(data.last_heartbeat_gmt));
    setStrip("teleToday", (data.trades_today != null ? data.trades_today : "—") + T.trades);

    animateNumber("ret12", data.return_12m, function (v) { return pct(v, true); });
    animateNumber("maxdd", data.max_drawdown, function (v) { return "−" + pct(v, false); });
    animateNumber("ret1", data.return_1m, function (v) { return pct(v, true); });
    animateNumber("ret3", data.return_3m, function (v) { return pct(v, true); });
    animateNumber("curdd", data.current_drawdown, function (v) { return "−" + pct(v, false); });
    animateNumber("winrate", data.win_rate, function (v) { return v.toFixed(1) + "%"; });
    animateNumber("trades", data.trades_total, function (v) { return Math.round(v) + T.trades; });
    setText("avghold", minutesText(data.avg_hold_minutes));

    chart.curve = data.equity_curve || [];
    var perf = $("performance");
    renderChart(!chart.drawn && !!(perf && perf.classList.contains("is-in")));
    chart.drawn = true;

    drawTrades(data.closed_trades_recent);

    // the drawdown is repeated inside a sentence, so it cannot be read alone
    setText("bindDD", "−" + pct(data.max_drawdown, false));
    var inline = $("demoInline");
    if (inline) inline.hidden = !data.demo_notice;

    setText("footSymbol", data.symbol || "—");
    setText("footVersion", "brain " + (data.brain_version || "—"));
    setText("footGenerated", T.generated + (data.generated_gmt || "—"));

    var url = data.broker_page_url;
    ["copyBtn", "heroCopyBtn", "verifyLink"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (url) {
        el.setAttribute("href", url);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
        el.removeAttribute("aria-disabled");
        el.removeAttribute("tabindex");
      } else if (id === "copyBtn") {
        // aria-disabled only tells assistive tech the control is off; it does
        // not stop it working. An anchor with no href is genuinely inert: not
        // focusable, not activatable, and it still takes the .btn styling.
        el.removeAttribute("href");
        el.setAttribute("aria-disabled", "true");
        el.setAttribute("tabindex", "-1");
      }
    });
    if (!url) setText("copyBtnNote", T.brokerPending);

    queueSnap();     // the ledger just changed every position below it
  }

  function load() {
    fetch(STATUS_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
        render(data, false);
      })
      .catch(function () {
        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) {}
        if (cached) render(cached, true);
        else {
          loaded();                       // the honest dashes, not skeletons
          setText("updatedAgo", T.unavailable);
          setText("stateText", T.state.offline);
          // the skeleton rows would otherwise sit there as four blank lines
          var body = $("tradesBody");
          if (body) body.innerHTML = '<tr><td colspan="4" class="s-meta">' + T.unavailable + "</td></tr>";
        }
      });
  }

  // Loaded in a background tab: redraw once the visitor actually looks at it.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden || !lastData || seenByVisitor) return;
    ["ret12", "maxdd", "ret1", "ret3", "curdd", "winrate", "trades"].forEach(function (id) {
      var el = $(id);
      if (el) el.removeAttribute("data-v");
    });
    chart.drawn = false;
    render(lastData, lastOffline);
  });

  /* Both of these exist because the language links are plain hrefs: switching
     language used to throw away the chosen time range and drop the reader back
     at the top, which is worst exactly where the page is longest. */
  function restoreRange() {
    var saved = null;
    try { saved = sessionStorage.getItem("range"); } catch (e) { return; }
    if (saved === null) return;
    chart.range = parseInt(saved, 10) || 0;
    var buttons = document.querySelectorAll(".seg button");
    Array.prototype.forEach.call(buttons, function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-range") === saved);
    });
  }

  function wireLangLinks() {
    var ids = ["contact", "follow", "risk", "how", "chain", "performance"];
    var links = document.querySelectorAll("a.lang");
    Array.prototype.forEach.call(links, function (a) {
      a.addEventListener("click", function () {
        var here = "";
        for (var i = 0; i < ids.length; i++) {
          var el = $(ids[i]);
          if (el && el.getBoundingClientRect().top <= 80) { here = ids[i]; break; }
        }
        var base = (a.getAttribute("href") || "").split("#")[0];
        a.setAttribute("href", here ? base + "#" + here : base);
      });
    });
  }


  /* ---------- paging ----------

     One flick should land on the next page. That only works if no two snap
     points are more than a viewport apart: with `mandatory` snapping, a page
     taller than the screen is a page the reader cannot finish, because the
     browser keeps pulling them back to its top. Section 02 alone is 1.86
     screens on a desktop and 2.49 on a phone, so whole sections cannot be the
     pages.

     The blocks inside them can, but which ones depends on the viewport -- at
     375px wide the same content is half again as tall. So the set is chosen
     here instead of being written down: walk the candidate blocks in order and
     greedily keep the furthest one still within a viewport of the last kept,
     which makes every page as large as it can be while none overflows.

     If even the next candidate is out of reach -- one block taller than the
     screen with nothing to break it up -- there is no safe set, and the page
     stays on `proximity`. Trapping someone is never the better outcome. */
  /* The individual cards and list items are candidates too. More candidates can
     only help: the walk always takes the furthest one still in reach, so extra
     ones let it pack pages tighter and never make a page smaller than it had
     to be. Without them the six-card grid in 04 is 848px of unbroken column on
     a phone -- further than one screen -- and the whole page falls back. */
  /* Three arrangements, switchable from the URL so they can be compared
     without editing anything:

       ?scroll=plain   native scrolling only -- no damping, no snapping
       ?scroll=snap    CSS snapping, wheel stays the browser's
       ?scroll=pages   snapping plus wheel paging: jumps stop to stop
       (default)       damped continuous scrolling, no snapping

     Four rounds of "still not smooth" went by without anyone knowing whether
     the scroll layers are the problem or the frame rate is. Asking for a
     console measurement did not get one. This is the cheap way to find out:
     open two links, say which feels right. If `plain` is still not smooth then
     none of this is the cause and the canvas is, and no amount of work on the
     scrolling will ever fix it. */
  var SCROLL_MODE = (function () {
    var m = /[?&]scroll=(plain|snap|pages|smooth)/.exec(location.search);
    return m ? m[1] : "smooth";
  })();

  var SNAP_CANDIDATES = ".hero, .s, .figures, .fig, .chart, .row, .ledger, .cols, .col," +
    " .chain, .chain > li, .steps, .steps > li, .risks, .risks > li, .chips";
  var SNAP_ANCHORS = ".hero, .s";   // never dropped: these are the link targets
  /* Two tiers. Pages are AIMED at 0.92 of the viewport, so nothing sits flush
     against the edge and a phone's address bar sliding back in does not clip
     one. But a block that has nothing inside it to split on is allowed up to
     0.99 rather than failing the whole page: the English hero is 790px in an
     812px viewport -- it fits the screen with room to spare, and rejecting it
     dropped the entire document back to soft snapping. */
  var SNAP_FILL = 0.92;             // what a page aims for
  var SNAP_MAX = 0.99;              // what a page is still allowed to be

  function pageSnap() {
    var root = document.documentElement;
    var all = document.querySelectorAll(".snap");
    for (var c = 0; c < all.length; c++) all[c].classList.remove("snap");
    root.classList.remove("snap-pages");
    if (reduced) return;
    if (SCROLL_MODE !== "snap" && SCROLL_MODE !== "pages") return;

    var vh = window.innerHeight || root.clientHeight;
    if (!vh) return;
    var reach = vh * SNAP_FILL, hardMax = vh * SNAP_MAX;

    var nodes = document.querySelectorAll(SNAP_CANDIDATES);
    var cands = [];
    for (var i = 0; i < nodes.length; i++) {
      var top = nodes[i].getBoundingClientRect().top + (window.pageYOffset || 0);
      // blocks that start within a hair of each other are the same page
      if (cands.length && top - cands[cands.length - 1].top < 24) continue;
      cands.push({ el: nodes[i], top: top, must: !!nodes[i].matches(SNAP_ANCHORS) });
    }
    if (cands.length < 2) return;

    /* Every section top has to stay a snap point, or `mandatory` drags an
       anchor jump off its target: #risk arrives, the browser then snaps to
       whichever point is nearest, and the reader lands 359px into the wrong
       page. The language switch carries exactly those fragments, so this is
       not cosmetic. Sections are kept unconditionally; the blocks between them
       are only used to bridge a gap that is wider than the screen. */
    var kept = [], lastTop = -1;
    function keep(c) { kept.push(c); lastTop = c.top; }

    /* Pages between two section tops are spaced evenly, not greedily. Taking
       the furthest reachable point every time filled the first page and left
       the remainder as a stub -- a 0.39-screen page is a twitch, not a turn,
       and a run of uneven ones is most of what reads as "not smooth". Work out
       how many pages the gap needs, then put each stop as near as possible to
       an even division of it. */
    function bridgeTo(limit) {
      var span = limit - lastTop;
      if (span <= reach) return true;
      var pages = Math.ceil(span / reach);
      var step = span / pages;
      var from = lastTop;
      for (var k = 1; k < pages; k++) {
        var wantTop = from + step * k;
        var best = -1, bestD = 1e9;
        for (var j = 0; j < cands.length; j++) {
          var t = cands[j].top;
          if (t <= lastTop) continue;
          if (t >= limit || t - lastTop > reach) break;
          var d = wantTop > t ? wantTop - t : t - wantTop;
          if (d < bestD) { bestD = d; best = j; }
        }
        if (best >= 0) keep(cands[best]);   // no candidate near this division:
      }                                      // the top-up below will cover it

      /* The even divisions are where the stops WANT to be, but a stop can only
         go where a block actually starts, so the last leg can still overshoot.
         Close whatever is left greedily -- correctness first, evenness second. */
      while (limit - lastTop > reach) {
        var pick = -1;
        for (var q = 0; q < cands.length; q++) {
          var tq = cands[q].top;
          if (tq <= lastTop) continue;
          if (tq >= limit) break;
          if (tq - lastTop <= reach) pick = q;
        }
        // nothing to stand on: accept the stretch if it still fits the screen,
        // otherwise there is no safe set and the page stays on proximity
        if (pick < 0) return limit - lastTop <= hardMax;
        keep(cands[pick]);
      }
      return true;
    }

    keep(cands[0]);
    for (var m = 1; m < cands.length; m++) {
      if (!cands[m].must || cands[m].top <= lastTop) continue;
      if (!bridgeTo(cands[m].top)) return;
      keep(cands[m]);
    }
    if (!bridgeTo(root.scrollHeight - vh)) return;

    for (var k = 0; k < kept.length; k++) kept[k].el.classList.add("snap");
    root.classList.add("snap-pages");
  }

  /* Debounced on a timer, not on requestAnimationFrame. The ledger arrives
     with the summary and changes every position below it; if the re-measure
     never runs, `mandatory` is left applied to a stale layout, which is how a
     page ends up taller than the screen -- the one outcome this is all meant
     to prevent. A frame callback can be throttled; a timer cannot. */
  var snapTimer = 0;
  function queueSnap() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(pageSnap, 100);
  }


  /* ---------- wheel paging (desktop, mouse only) ----------

     CSS scroll-snap decides WHERE a page lands but not how long it takes to
     get there: there is no property for the duration, it is the browser's.
     The only way to set the pace is to move the scroll position ourselves.

     So the scope is kept as narrow as it can be. Only `wheel` is taken over.
     Everything else stays the browser's:

       keyboard paging, Home/End, space      native
       find-in-page                          native
       anchor links and the language switch  native
       touch                                 native
       a trackpad's fine-grained scrolling   native (small deltas pass through)

     Which leaves one cost: a mouse wheel no longer scrolls freely, it turns a
     page. That is the thing being asked for. Everything else about getting
     around the document is untouched -- and if any of this throws, the
     listener takes itself off and the browser has the wheel back. */
  /* Three dials, in the order you are most likely to want them:
       WHEEL_PAGING  false gives the wheel back to the browser entirely
       PAGE_MS       how long one turn takes; lower is faster
       WHEEL_MIN     below this delta it is a trackpad gliding, and it is
                     passed through untouched */
  var glideTo = null;        // set by dampedScroll once it is running
  var WHEEL_PAGING = true;
  var PAGE_MS = 760;
  var WHEEL_MIN = 40;

  function wheelPaging() {
    var root = document.documentElement;
    if (!WHEEL_PAGING || reduced || SCROLL_MODE !== "pages") return;
    if (!window.matchMedia("(min-width: 900px)").matches) return;
    // a mouse, not a touchscreen or a tablet
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    var raf = 0, target = null, mine = -1, savedSnap = "", savedBeh = "", aborts = 0;

    function points() {
      var els = document.querySelectorAll(".snap"), out = [];
      for (var i = 0; i < els.length; i++) {
        out.push(Math.round(els[i].getBoundingClientRect().top + window.pageYOffset));
      }
      out.push(Math.max(0, root.scrollHeight - window.innerHeight));
      out.sort(function (a, b) { return a - b; });
      return out;
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; target = null; mine = -1;
      root.style.scrollSnapType = savedSnap;
      root.style.scrollBehavior = savedBeh;
    }

    function glide(to) {
      var from = window.pageYOffset;
      if (Math.abs(to - from) < 2) return;
      if (!raf) { savedSnap = root.style.scrollSnapType; savedBeh = root.style.scrollBehavior; }
      // the browser would snap every step of the way and fight the animation
      root.style.scrollSnapType = "none";
      /* The page sets `scroll-behavior: smooth`, which also applies to the
         scrollTo calls this animation makes -- so every frame was being
         re-animated by the browser, the real position never caught up with the
         value written, and the "something else moved the page" check below
         killed the glide on its first frame. Each notch travelled a little way
         and stopped. Turned off for the duration, and every write below asks
         for `auto` explicitly as well. */
      root.style.scrollBehavior = "auto";
      if (raf) cancelAnimationFrame(raf);
      target = to;
      var t0 = 0;
      raf = requestAnimationFrame(function run(now) {
        if (!t0) t0 = now;
        var t = (now - t0) / PAGE_MS;
        if (t > 1) t = 1;
        var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;
        mine = Math.round(from + (to - from) * e);
        window.scrollTo({ top: mine, behavior: "auto" });
        if (t < 1) { raf = requestAnimationFrame(run); return; }
        raf = 0; target = null; mine = -1; aborts = 0;
        root.style.scrollSnapType = savedSnap;
        root.style.scrollBehavior = savedBeh;
      });
    }

    function onWheel(ev) {
      try {
        if (ev.ctrlKey || ev.metaKey) return;            // that is a zoom
        var dy = ev.deltaY;
        if (!dy) return;
        // deltaMode 1/2 is lines or pages: always a wheel. Mode 0 with a small
        // delta is a trackpad gliding, and turning that into page jumps feels
        // broken, so it is left alone.
        if (ev.deltaMode === 0 && Math.abs(dy) < WHEEL_MIN) return;
        ev.preventDefault();

        var pts = points();
        // queue from where the current turn is heading, so a second flick
        // during a turn advances instead of being swallowed
        var here = target === null ? window.pageYOffset : target;
        var next = null, i;
        if (dy > 0) {
          for (i = 0; i < pts.length; i++) if (pts[i] > here + 2) { next = pts[i]; break; }
        } else {
          for (i = pts.length - 1; i >= 0; i--) if (pts[i] < here - 2) { next = pts[i]; break; }
        }
        if (next === null) return;
        glide(next);
      } catch (e) {
        window.removeEventListener("wheel", onWheel);    // give the wheel back
        stop();
      }
    }

    // anything that moved the page and was not this animation wins
    window.addEventListener("scroll", function () {
      // 16px of slack: browser zoom and display scaling make the scroll
      // position fractional, so a written integer never reads back exactly
      if (!raf || Math.abs(window.pageYOffset - mine) <= 16) return;
      stop();
      /* If the glide keeps being overruled, something on this machine is
         driving the scroll as well and the two will fight forever. Three in a
         row and the wheel goes back to the browser for good -- a page that
         scrolls plainly beats one that stutters. */
      if (++aborts >= 3) window.removeEventListener("wheel", onWheel);
    }, { passive: true });

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", stop, { passive: true });
    /* A hidden tab gets no animation frames, so a glide in flight simply stops
       -- and it stops holding the two inline overrides open, which would leave
       snapping switched off on the page until the next one happened to finish. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
    });
  }

  wireChart();
  wireReveal();
  wireLangLinks();
  pageSnap();

  /* ---------- damped wheel scrolling (desktop, mouse only) ----------

     This is not paging. Paging jumps from one stop to the next, which is what
     "it flies straight over there" meant; what was wanted is the opposite --
     the scroll stays continuous and just gets heavy. The wheel moves a target,
     and each frame the page closes a fraction of whatever distance is left, so
     it starts, glides, and settles rather than stepping.

     Same narrow scope as before: only `wheel`, and only a mouse's discrete
     notches. Keyboard, find-in-page, anchors, touch and a trackpad's own
     smooth scrolling all stay the browser's. Snapping is off in this mode --
     a snap point would yank the glide every time it tried to settle. */
  var SCROLL_REACH = 0.9;    // distance per notch, against the browser's own
  /* Time constant, not a per-frame fraction. "Close 7% of the gap each frame"
     is only the intended speed at one frame rate: on a machine running at 30fps
     the same glide takes twice as long, which is exactly the wrong way round --
     the slower the machine, the more sluggish it would feel. This is the
     exponential form, so a given stretch of real time always covers the same
     ground. (The canvas had this same bug earlier; see `approach` in core.js.) */
  var SCROLL_TAU = 420;      // ms; larger is heavier
  /* A wheel notch on Windows is three "lines". Chromium normally reports it
     already converted to about 100px, but when a browser or a driver reports
     lines instead, 18 each would move half as far as everything else on the
     machine -- the page would crawl for that one person and nobody would know
     why. 34 x 3 lands on the same ~100px. */
  var LINE_PX_DEFAULT = 34;

  /* Both dials are also readable from the URL, because how this feels cannot be
     measured from here -- the preview pane throttles requestAnimationFrame, so
     every timing reading it gives is wrong. Rather than another round of
     guessing a number and asking whether it felt right:
         ?tau=180     lighter, snappier
         ?tau=400     heavier, longer glide
         ?reach=1.2   more ground per notch
     Whatever ends up feeling right becomes the constant above. */
  (function () {
    var q = location.search;
    var mt = /[?&]tau=(\d{2,4})/.exec(q);
    if (mt) SCROLL_TAU = +mt[1];
    var mr = /[?&]reach=([\d.]{1,5})/.exec(q);
    if (mr && +mr[1] > 0) SCROLL_REACH = +mr[1];
  })();
  var LINE_PX = LINE_PX_DEFAULT;   // a "line" of delta, when the OS reports lines

  function dampedScroll() {
    var root = document.documentElement;
    if (reduced || SCROLL_MODE !== "smooth") return;
    if (!window.matchMedia("(min-width: 900px)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    var target = 0, raf = 0, mine = -1, savedSnap = "", savedBeh = "", aborts = 0, began = 0;
    var lastNotch = 0, streak = 0, guard = 0;

    function limit() { return Math.max(0, root.scrollHeight - window.innerHeight); }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; mine = -1; last = 0;
      clearTimeout(guard); guard = 0;
      root.style.scrollSnapType = savedSnap;
      root.style.scrollBehavior = savedBeh;
    }

    function begin() {
      if (raf) return;
      target = window.pageYOffset;                 // pick up from where we are
      savedSnap = root.style.scrollSnapType;
      savedBeh = root.style.scrollBehavior;
      /* Both of these would fight the glide: a snap point pulls the position
         every frame, and `scroll-behavior: smooth` re-animates each write so
         the position never matches what was asked for. */
      root.style.scrollSnapType = "none";
      root.style.scrollBehavior = "auto";
      began = Date.now();
      clearTimeout(guard);
      guard = setTimeout(stop, 4000);
      raf = requestAnimationFrame(run);
      // the canvas must draw AFTER this frame's scroll write, not before it
      if (window.coreYield) window.coreYield();
    }

    var last = 0;
    function run(now) {
      var dt = last ? now - last : 16.7;
      last = now;
      if (dt > 100) dt = 100;                    // a long stall must not teleport
      var cur = window.pageYOffset, gap = target - cur;
      if (gap > -0.6 && gap < 0.6) {
        window.scrollTo({ top: Math.round(target), behavior: "auto" });
        aborts = 0;
        stop();
        return;
      }
      mine = Math.round(cur + gap * (1 - Math.exp(-dt / SCROLL_TAU)));
      window.scrollTo({ top: mine, behavior: "auto" });
      raf = requestAnimationFrame(run);
    }

    function onWheel(ev) {
      try {
        if (ev.ctrlKey || ev.metaKey) return;        // that is a zoom
        var dy = ev.deltaY;
        if (!dy) return;
        if (ev.deltaMode === 1) dy *= LINE_PX;               // lines
        else if (ev.deltaMode === 2) dy *= window.innerHeight; // pages
        else if (dy < WHEEL_MIN && dy > -WHEEL_MIN) return;  // trackpad: leave it
        ev.preventDefault();

        begin();
        /* Spinning the wheel hard should cover ground. Without this the page
           is 53 notches from top to bottom at a fixed 90px each, and damping
           makes that feel further than it is: every notch is the same size no
           matter how urgently it was asked for. Notches arriving in quick
           succession compound, up to about 2.5x. */
        var now = Date.now();
        streak = (now - lastNotch < 130) ? (streak < 11 ? streak + 1 : 11) : 0;
        lastNotch = now;
        target += dy * SCROLL_REACH * (1 + streak * 0.14);
        if (target < 0) target = 0;
        var top = limit();
        if (target > top) target = top;
      } catch (e) {
        window.removeEventListener("wheel", onWheel);   // give the wheel back
        stop();
      }
    }

    window.addEventListener("scroll", function () {
      // 16px of slack: browser zoom and display scaling make the scroll
      // position fractional, so a written integer never reads back exactly
      if (!raf || Math.abs(window.pageYOffset - mine) <= 16) return;
      /* Someone else moved the page, so let them have it. Only an abort in the
         first moments counts against the glide: being interrupted later is just
         a reader grabbing the scrollbar or following a link, and counting those
         would switch the wheel off during ordinary use. Being overruled the
         instant it starts, again and again, is the signature of something else
         driving the scroll -- and two things fighting is worse than neither. */
      var early = Date.now() - began < 150;
      stop();
      if (!early) { aborts = 0; return; }
      if (++aborts >= 5) window.removeEventListener("wheel", onWheel);
    }, { passive: true });

    /* Same glide, shared. Three different feels for "move down the page" --
       a 420ms damped wheel, the browser's instant keyboard steps, and its own
       smooth scroll for anchors -- is the sort of inconsistency that reads as
       carelessness even when nobody can name it. */
    glideTo = function (y) {
      var top = limit();
      begin();
      target = y < 0 ? 0 : (y > top ? top : y);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    /* A hidden tab gets no animation frames, so a glide in flight simply stops
       -- and it stops holding the two inline overrides open, which would leave
       snapping switched off on the page until the next one happened to finish. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
    });
  }

  /* ---------- keyboard and in-page links, on the same glide ---------- */
  function typingInto(el) {
    if (!el || !el.closest) return false;
    return !!el.closest("input, textarea, select, [contenteditable]");
  }

  function wireGlidedNav() {
    var root = document.documentElement;

    document.addEventListener("keydown", function (ev) {
      if (!glideTo) return;                       // wheel paging is off here
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (typingInto(ev.target)) return;          // space belongs to the field
      var vh = window.innerHeight, step = null;
      switch (ev.key) {
        case "PageDown": step = vh * 0.85; break;
        case "PageUp": step = -vh * 0.85; break;
        case " ": step = ev.shiftKey ? -vh * 0.85 : vh * 0.85; break;
        case "ArrowDown": step = 96; break;
        case "ArrowUp": step = -96; break;
        case "Home": step = "top"; break;
        case "End": step = "end"; break;
        default: return;
      }
      ev.preventDefault();
      if (step === "top") glideTo(0);
      else if (step === "end") glideTo(root.scrollHeight);
      else glideTo(window.pageYOffset + step);
    });

    document.addEventListener("click", function (ev) {
      if (!glideTo) return;
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button) return;
      var id = a.getAttribute("href").slice(1);
      if (!id) return;
      var el = document.getElementById(id);
      if (!el) return;
      ev.preventDefault();
      glideTo(el.getBoundingClientRect().top + window.pageYOffset);
      if (history.replaceState) history.replaceState(null, "", "#" + id);
    });
  }

  /* ---------- the progress rail ---------- */
  function wireRail() {
    var rail = $("rail");
    if (!rail) return;
    var root = document.documentElement;
    var bar = rail.querySelector(".rail-thumb");
    var at = rail.querySelector(".rail-at");
    var idle = 0, vh = 1, doc = 1, usable = false, marks = [], shown = null;

    /* Sizes are measured when the layout changes, never while scrolling.
       Reading `scrollHeight` forces the browser to settle the layout there and
       then, and doing that on every scroll event is the exact cost that was
       stripped out of the canvas earlier. What is left runs on every scroll is
       one transform write, which the compositor takes without touching layout,
       so it can be synchronous -- no frame callback to be throttled, and the
       rail can never be left showing a stale position. */
    function measure() {
      vh = window.innerHeight;
      doc = root.scrollHeight;
      usable = doc > vh + 4;
      if (!usable) { rail.classList.remove("is-on"); return; }

      /* One tick per section, placed by the same ratio as the thumb. The label
         is the section's own eyebrow -- 02, 03, 04 -- so the rail and the page
         are numbering the same things. Rebuilt only when the layout changes. */
      var old = rail.querySelectorAll(".rail-tick");
      for (var k = 0; k < old.length; k++) old[k].remove();
      marks = [];
      var secs = document.querySelectorAll(".hero, .s");
      for (var i = 0; i < secs.length; i++) {
        var top = secs[i].getBoundingClientRect().top + window.pageYOffset;
        var eb = secs[i].querySelector(".eyebrow");
        marks.push({ top: top, label: eb ? eb.textContent.trim() : "" });
        if (!i) continue;                       // no tick at the very top
        var t = document.createElement("span");
        t.className = "rail-tick";
        t.style.top = (top / doc * vh).toFixed(2) + "px";
        rail.appendChild(t);
      }
      paint();
    }

    function paint() {
      if (!usable) return;
      var y = window.pageYOffset;
      var top = y / doc * vh;
      bar.style.transform =
        "translateY(" + top.toFixed(2) + "px) scaleY(" + (vh / doc).toFixed(4) + ")";
      if (!at) return;
      // whichever section has reached the upper third is the one being read
      var here = "", edge = y + vh * 0.32;
      for (var i = 0; i < marks.length; i++) if (marks[i].top <= edge) here = marks[i].label;
      if (here !== shown) { shown = here; at.textContent = here; }
      at.style.transform =
        "translateY(" + (top + vh / doc * vh / 2 - 7).toFixed(2) + "px)";
    }

    function onScroll() {
      paint();
      if (!usable) return;
      rail.classList.add("is-on");
      clearTimeout(idle);
      idle = setTimeout(function () { rail.classList.remove("is-on"); }, 1000);
    }

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    // the ledger arrives with the summary and changes the document height
    if (typeof ResizeObserver === "function" && document.body) {
      new ResizeObserver(measure).observe(document.body);
    }
  }

  wheelPaging();
  dampedScroll();
  wireGlidedNav();
  wireRail();
  window.addEventListener("resize", queueSnap);
  window.addEventListener("load", queueSnap);
  if (typeof ResizeObserver === "function" && document.body) {
    new ResizeObserver(queueSnap).observe(document.body);
  }
  load();
  setInterval(load, REFRESH_MS);
})();
