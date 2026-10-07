/* Historical winners in the main summary. Account performance is a separate,
   unchanged view: point totals must never be presented as account returns. */
(function () {
  "use strict";
  var root = document.getElementById("performance");
  if (!root) return;
  var host = root.querySelector(".wrap"), heading = root.querySelector(".s-title");
  if (!host || !heading || document.getElementById("recordViewControls")) return;
  var en = (document.documentElement.lang || "zh").slice(0, 2) === "en";
  var NS = "http://www.w3.org/2000/svg", CACHE = "rion.history-view.cache.v1";
  var url = document.documentElement.getAttribute("data-status") || "data/status.json";
  var last = null, rows = [], limit = 12, cutoff = null, preferred = "history", active = "current";
  var busy = false;
  try { preferred = sessionStorage.getItem("rion.record-view") === "current" ? "current" : "history"; } catch (e) {}
  function words(zh, english) { return en ? english : zh; }
  function node(tag, cls, text, id) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    if (id) el.id = id;
    return el;
  }
  function number(n) {
    return Number(n).toLocaleString(en ? "en-US" : "zh-CN", { maximumFractionDigits: 1 });
  }
  function points(n) { return (n > 0 ? "+" : "") + number(n); }
  function stamp(s) { return String(s || "").slice(0, 19).replace("T", " "); }
  function finite(n) { return typeof n === "number" && isFinite(n); }
  function select(data) {
    var p = data && data.previous_profits, end = Date.parse(data && data.generated_gmt);
    var at = Date.parse(data && data.record_since_gmt);
    if (!p || p.enabled !== true || p.selection !== "profitable_only" || p.included_in_performance !== false ||
        !isFinite(end) || !isFinite(at) || p.cutoff_gmt !== data.record_since_gmt ||
        (p.boundary !== "open" && p.boundary !== "close") || !Array.isArray(p.trades)) return [];
    return p.trades.filter(function (t) {
      if (!t || t.is_profitable !== true || !finite(t.result_points) || !finite(t.hold_minutes) ||
          t.hold_minutes < 0 || (t.side !== "BUY" && t.side !== "SELL")) return false;
      var o = Date.parse(t.opened_gmt), c = Date.parse(t.closed_gmt);
      return isFinite(o) && isFinite(c) && o <= c && c <= end && (p.boundary === "open" ? o : c) < at;
    }).slice().sort(function (a, b) { return Date.parse(a.closed_gmt) - Date.parse(b.closed_gmt); });
  }

  // Keep the original renderer and its metrics intact. Its existing element IDs
  // still work inside this wrapper, including asynchronous heartbeat refreshes.
  var current = node("div", "record-current", undefined, "currentRecordView");
  var children = Array.prototype.slice.call(host.children);
  children.forEach(function (el) { if (!el.classList.contains("s-head")) current.appendChild(el); });
  var controls = node("div", "record-controls", undefined, "recordViewControls");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", words("选择记录范围", "Choose record scope"));
  var historyButton = node("button", "record-button", words("历史盈利精选", "Historical winners"), "historyViewButton");
  var currentButton = node("button", "record-button", words("本期全部交易", "All current-period trades"), "currentViewButton");
  [historyButton, currentButton].forEach(function (b) { b.type = "button"; controls.appendChild(b); });
  var history = node("div", "record-history", undefined, "historyRecordView");
  history.hidden = true;
  var message = node("p", "scope record-message", words("正在读取历史盈利记录…", "Loading historical winning trades…"), "historyViewMessage");
  message.setAttribute("aria-live", "polite");
  var emptyCurrent = node("p", "scope", "", "currentRecordEmpty");
  emptyCurrent.hidden = true;
  current.insertBefore(emptyCurrent, current.firstChild);
  host.appendChild(controls); host.appendChild(message); host.appendChild(history); host.appendChild(current);
  historyButton.setAttribute("aria-controls", "historyRecordView");
  currentButton.setAttribute("aria-controls", "currentRecordView");

  // Leave button activation to the browser, not the legacy page-scroll handler.
  [controls, history].forEach(function (el) {
    el.addEventListener("keydown", function (event) {
      if (event.target.closest("button") && (event.key === " " || event.key === "Enter")) event.stopPropagation();
    });
  });

  function choose(mode, remember) {
    if (remember) {
      preferred = mode;
      try { sessionStorage.setItem("rion.record-view", mode); } catch (e) {}
    }
    active = mode === "history" && rows.length ? "history" : "current";
    current.hidden = active !== "current"; history.hidden = active !== "history";
    historyButton.setAttribute("aria-pressed", String(active === "history"));
    currentButton.setAttribute("aria-pressed", String(active === "current"));
    heading.textContent = active === "history" ? words("表现摘要 · 历史盈利精选", "Performance summary · Historical winners")
      : words("表现摘要 · 本期全部交易", "Performance summary · All current trades");
    // The existing chart was measured while hidden; remeasure it on return.
    window.dispatchEvent(new Event("resize"));
  }
  historyButton.addEventListener("click", function () { choose("history", true); });
  currentButton.addEventListener("click", function () { choose("current", true); });

  function figure(parent, label, value, id) {
    var box = node("div", "fig"); box.appendChild(node("span", "fig-k", label));
    box.appendChild(node("span", "fig-v gold", value, id)); parent.appendChild(box);
  }
  function small(parent, label, value, id) {
    var box = node("div"); box.appendChild(node("span", "", label));
    box.appendChild(node("b", "", value, id)); parent.appendChild(box);
  }
  function drawCurve(parent, list, total) {
    var box = node("div", "chart history-chart");
    box.appendChild(node("div", "chart-head", words("累计价格变动 · 点数合计，从 0 开始", "Cumulative price movement · Points, starting at 0")));
    var svg = document.createElementNS(NS, "svg");
    svg.id = "historyPointsChart"; svg.setAttribute("viewBox", "0 0 1000 280");
    svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", words("历史盈利精选的累计价格变动：", "Cumulative points for selected historical winners: ") + number(total));
    var values = [0], sum = 0;
    list.forEach(function (t) { sum += t.result_points; values.push(sum); });
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), span = hi - lo || 1;
    function y(v) { return 250 - (v - lo) / span * 230; }
    var baseline = document.createElementNS(NS, "line");
    baseline.setAttribute("x1", "0"); baseline.setAttribute("x2", "1000");
    baseline.setAttribute("y1", y(0)); baseline.setAttribute("y2", y(0));
    baseline.setAttribute("class", "history-baseline"); svg.appendChild(baseline);
    var line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", values.map(function (v, i) { return (i * 1000 / (values.length - 1)).toFixed(2) + "," + y(v).toFixed(2); }).join(" "));
    line.setAttribute("fill", "none"); line.setAttribute("class", "history-line");
    line.setAttribute("vector-effect", "non-scaling-stroke"); svg.appendChild(line); box.appendChild(svg);
    var foot = node("div", "chart-foot");
    foot.appendChild(node("span", "", list[0].closed_gmt.slice(0, 10) + " · 0"));
    foot.appendChild(node("span", "", list[list.length - 1].closed_gmt.slice(0, 10) + " · " + points(total)));
    box.appendChild(foot);
    box.appendChild(node("p", "scope", words("横轴按平仓先后排列；每笔点数直接相加，未按仓位加权。这不是账户净值曲线。", "Trades are ordered by close time. Points are added without position-size weighting. This is not an account equity curve.")));
    parent.appendChild(box);
  }
  function drawHistory(data) {
    history.replaceChildren();
    var total = rows.reduce(function (s, t) { return s + t.result_points; }, 0);
    var holds = rows.reduce(function (s, t) { return s + t.hold_minutes; }, 0);
    var buys = rows.filter(function (t) { return t.side === "BUY"; }).length;
    var day = data.generated_gmt.slice(0, 10);
    history.appendChild(node("p", "scope history-disclosure", words(
      "仅精选历史盈利交易，不含旧亏损，不代表完整历史表现。这里展示价格变动点数，不是账户收益率；本期盈利与亏损均保留在“本期全部交易”中。",
      "Selected historical winning trades only; old losses are excluded. This is not the complete track record. Figures are price-movement points, not account returns. All current-period wins and losses remain in the other view.")));
    var figures = node("div", "figures");
    figure(figures, words("累计价格变动（点）", "Total price movement (points)"), points(total), "historyPoints");
    figure(figures, words("历史盈利交易（笔）", "Selected winning trades"), number(rows.length), "historyCount");
    history.appendChild(figures); drawCurve(history, rows, total);
    var summary = node("div", "row");
    small(summary, words("平均每笔（点）", "Mean move (points)"), points(total / rows.length), "historyAverage");
    small(summary, words("最大单笔（点）", "Largest move (points)"), points(Math.max.apply(null, rows.map(function (t) { return t.result_points; }))), "historyBest");
    small(summary, words("今日精选平仓（GMT）", "Selected closes today (GMT)"), number(rows.filter(function (t) { return t.closed_gmt.slice(0, 10) === day; }).length), "historyToday");
    small(summary, words("买入 / 卖出", "Buy / Sell"), buys + " / " + (rows.length - buys), "historySides");
    small(summary, words("平均持仓时长", "Average holding time"), number(Math.round(holds / rows.length)) + words(" 分钟", " min"), "historyHold");
    small(summary, words("累计精选已平仓", "Selected closed trades"), number(rows.length) + words(" 笔", " trades"), "historyTotal");
    history.appendChild(summary);
    var ledger = node("div", "ledger");
    ledger.appendChild(node("div", "chart-head", words("最近已平仓 · 历史盈利精选", "Recent closed trades · Historical winners")));
    var table = node("table", "trades"), head = node("thead"), hr = node("tr");
    [words("平仓时间 (GMT)", "Closed (GMT)"), words("方向", "Side"), words("持仓时长", "Holding time"), words("价格变动（点）", "Move (points)")].forEach(function (text, i) {
      var th = node("th", i === 3 ? "r" : "", text); th.scope = "col"; hr.appendChild(th);
    });
    head.appendChild(hr); table.appendChild(head);
    var body = node("tbody", "", undefined, "historyTradesBody");
    rows.slice().reverse().slice(0, limit).forEach(function (t) {
      var tr = node("tr");
      [stamp(t.closed_gmt), t.side, number(t.hold_minutes) + words(" 分钟", " min"), points(t.result_points)].forEach(function (text, i) {
        var cls = i === 1 ? (t.side === "BUY" ? "buy" : "sell") : i === 3 ? "r " + (t.result_points >= 0 ? "pos" : "neg") : "";
        tr.appendChild(node("td", cls, text));
      }); body.appendChild(tr);
    });
    table.appendChild(body); ledger.appendChild(table);
    ledger.appendChild(node("p", "scope", words("已显示 ", "Showing ") + Math.min(limit, rows.length) + " / " + rows.length, "historyShown"));
    if (limit < rows.length) {
      var more = node("button", "record-button history-more", words("显示更多历史盈利", "Show more historical winners"), "historyMore");
      more.type = "button"; more.addEventListener("click", function () {
        var previous = limit; limit += 12; drawHistory(last);
        var firstNew = document.querySelectorAll("#historyTradesBody tr")[previous];
        if (firstNew) { firstNew.tabIndex = -1; firstNew.focus({ preventScroll: true }); }
        window.dispatchEvent(new Event("resize"));
      }); ledger.appendChild(more);
    }
    history.appendChild(ledger);
  }
  function render(data, cached) {
    last = data; rows = select(data);
    if (cutoff !== data.record_since_gmt) { limit = 12; cutoff = data.record_since_gmt; }
    historyButton.disabled = !rows.length;
    historyButton.textContent = words("历史盈利精选", "Historical winners") + " · " + rows.length;
    currentButton.textContent = words("本期全部交易", "All current-period trades") + " · " + (finite(data.trades_total) ? data.trades_total : "—");
    var reported = data.previous_profits && data.previous_profits.trades_total;
    var partial = rows.length && finite(reported) && reported !== rows.length;
    message.textContent = (cached ? words("暂时无法更新，显示缓存。", "Cannot refresh; showing cached data. ") : "") +
      (rows.length ? words("历史数据更新于 ", "History updated ") + stamp(data.generated_gmt) + " GMT" +
        (partial ? words(" · 部分记录未通过校验，仅显示有效条目。", " · Some records were invalid; only validated entries are shown.") : "")
      : words("暂无可用的历史盈利精选，当前显示本期记录。", "No historical winner selection available; showing the current record."));
    emptyCurrent.hidden = data.trades_total !== 0;
    emptyCurrent.textContent = words("本期尚无已平仓交易。统计起点：", "No current-period trades have closed yet. Record starts: ") + stamp(data.record_since_gmt) + " GMT";
    if (rows.length) drawHistory(data); else history.replaceChildren();
    root.classList.add("record-view-ready");
    choose(preferred, false);
  }
  function load() {
    if (busy) return; busy = true;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;
    var options = { cache: "no-store" }; if (controller) options.signal = controller.signal;
    fetch(url, options).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        if (!data || data.schema !== "rionea99.status/1") throw new Error("Invalid status schema");
        render(data, false);
        try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch (e) {}
      }).catch(function () {
        var saved = last;
        if (!saved) try { saved = JSON.parse(localStorage.getItem(CACHE) || "null"); } catch (e) {}
        if (saved && saved.schema === "rionea99.status/1") render(saved, true);
        else {
          message.textContent = words("无法读取历史盈利记录，本期数据由原页面继续更新。", "Cannot load historical winners. The original current-record view continues updating.");
          historyButton.disabled = true; choose("current", false);
        }
      }).then(function () { clearTimeout(timer); busy = false; });
  }
  choose("current", false); load();
  setInterval(function () { if (!document.hidden) load(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
