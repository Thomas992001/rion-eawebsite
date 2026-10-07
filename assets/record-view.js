/* One performance section: historical winners and current closed trades share
   the same point summary, chart and ledger. Account metrics retain their scope. */
(function () {
  "use strict";
  var root = document.getElementById("performance");
  if (!root || document.getElementById("unifiedRecord")) return;
  var host = root.querySelector(".wrap"), heading = root.querySelector(".s-title");
  if (!host || !heading) return;
  var en = (document.documentElement.lang || "zh").slice(0, 2) === "en";
  var NS = "http://www.w3.org/2000/svg", CACHE = "rion.unified-record.cache.v2";
  var url = document.documentElement.getAttribute("data-status") || "data/status.json";
  var last = null, rows = [], limit = 12, cutoff = null, busy = false;
  function words(zh, english) { return en ? english : zh; }
  function node(tag, cls, text, id) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    if (id) el.id = id;
    return el;
  }
  function finite(n) { return typeof n === "number" && isFinite(n); }
  function number(n) {
    return finite(n) ? n.toLocaleString(en ? "en-US" : "zh-CN", { maximumFractionDigits: 1 }) : "—";
  }
  function points(n) { return finite(n) ? (n > 0 ? "+" : "") + number(n) : "—"; }
  function percent(n) { return finite(n) ? (n > 0 ? "+" : "") + n.toFixed(2) + "%" : "—"; }
  function stamp(s) { return String(s || "").slice(0, 19).replace("T", " "); }
  function minute(n) { return finite(n) ? number(Math.round(n)) + words(" 分钟", " min") : "—"; }
  function validTrade(t, end) {
    return t && finite(t.result_points) && finite(t.hold_minutes) && t.hold_minutes >= 0 &&
      (t.side === "BUY" || t.side === "SELL") && isFinite(Date.parse(t.closed_gmt)) && Date.parse(t.closed_gmt) <= end;
  }
  function select(data) {
    var p = data.previous_profits, end = Date.parse(data.generated_gmt), at = Date.parse(data.record_since_gmt);
    var old = [], recent = [], issues = [];
    if (p && p.enabled === true) {
      if (p.selection === "profitable_only" && p.included_in_performance === false && isFinite(at) &&
          p.cutoff_gmt === data.record_since_gmt && (p.boundary === "open" || p.boundary === "close") && Array.isArray(p.trades)) {
        old = p.trades.filter(function (t) {
          if (!validTrade(t, end) || t.is_profitable !== true) return false;
          var o = Date.parse(t.opened_gmt), c = Date.parse(t.closed_gmt);
          return isFinite(o) && o <= c && (p.boundary === "open" ? o : c) < at;
        });
        if (old.length !== p.trades.length || (finite(p.trades_total) && old.length !== p.trades_total))
          issues.push(words("部分旧记录未提供或未通过校验。", "Some older records are missing or invalid."));
      } else issues.push(words("旧记录口径不匹配，未合并。", "Older records have a mismatched scope and were not merged."));
    }
    // Current data is already cohort-filtered by the writer. Do not infer an
    // opening second from a rounded holding duration or remove same-time fills.
    var supplied = Array.isArray(data.closed_trades_all) ? data.closed_trades_all : data.closed_trades_recent;
    if (Array.isArray(supplied)) recent = supplied.filter(function (t) {
      if (!validTrade(t, end)) return false;
      var c = Date.parse(t.closed_gmt);
      if (isFinite(at) && c < at) return false;
      if (t.opened_gmt != null) {
        var o = Date.parse(t.opened_gmt);
        if (!isFinite(o) || o > c || (isFinite(at) && data.record_by === "open" && o < at)) return false;
      }
      return true; // Current losing and flat trades are deliberately retained.
    });
    if (finite(data.trades_total) && recent.length < data.trades_total) {
      issues.push(words("本期明细目前提供 ", "Current detail includes ") + recent.length + " / " + data.trades_total +
        words(" 笔；点数统计仅计入已提供明细，账户指标仍按本期全部记录计算。", " trades; point statistics cover supplied details only. Account metrics still cover the full current period."));
    } else if (Array.isArray(supplied) && recent.length !== supplied.length) {
      issues.push(words("部分本期明细未通过校验。", "Some current trade details were invalid."));
    }
    return { rows: old.concat(recent).sort(function (a, b) { return Date.parse(a.closed_gmt) - Date.parse(b.closed_gmt); }),
      hasOld: !!(p && p.enabled === true), issues: issues };
  }

  // Replace the previous split view rather than adding another dashboard. Keep
  // the original header/heartbeat; legacy IDs are removed so app.js cannot
  // overwrite this summary or recreate its separate historical ledger.
  Array.prototype.slice.call(host.children).forEach(function (el) {
    if (!el.classList.contains("s-head")) el.remove();
  });
  heading.textContent = words("表现摘要", "Performance summary");
  var view = node("div", "record-unified", undefined, "unifiedRecord");
  var message = node("p", "scope record-message", words("正在读取交易记录…", "Loading trade records…"), "recordMessage");
  message.setAttribute("aria-live", "polite");
  host.appendChild(message); host.appendChild(view);
  root.classList.add("record-unified-ready");
  // Retired tab preferences must not hide part of the single view.
  try { sessionStorage.removeItem("rion.record-view"); } catch (e) {}
  view.addEventListener("keydown", function (event) {
    if (event.target.closest("button") && (event.key === " " || event.key === "Enter")) event.stopPropagation();
  });
  function metric(parent, label, value, id, large) {
    var box = node("div", large ? "fig" : "");
    box.appendChild(node("span", large ? "fig-k" : "", label));
    box.appendChild(node(large ? "span" : "b", large ? "fig-v gold" : "", value, id)); parent.appendChild(box);
  }
  function drawCurve(parent, list, total) {
    var box = node("div", "chart record-chart");
    box.appendChild(node("div", "chart-head", words("累计价格变动 · 点数合计，从 0 开始", "Cumulative price movement · Points, starting at 0")));
    if (!list.length) { box.appendChild(node("p", "scope", words("暂无已平仓交易。", "No closed trades yet."))); parent.appendChild(box); return; }
    var svg = document.createElementNS(NS, "svg");
    svg.id = "recordPointsChart"; svg.setAttribute("viewBox", "0 0 1000 280");
    svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", words("展示记录累计点数：", "Cumulative points of displayed records: ") + number(total));
    var values = [0], sum = 0, lo = 0, hi = 0;
    list.forEach(function (t) { sum += t.result_points; values.push(sum); lo = Math.min(lo, sum); hi = Math.max(hi, sum); });
    var span = hi - lo || 1;
    function y(v) { return 250 - (v - lo) / span * 230; }
    var baseline = document.createElementNS(NS, "line");
    baseline.setAttribute("x1", "0"); baseline.setAttribute("x2", "1000");
    baseline.setAttribute("y1", y(0)); baseline.setAttribute("y2", y(0));
    baseline.setAttribute("class", "record-baseline"); svg.appendChild(baseline);
    var line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", values.map(function (v, i) { return (i * 1000 / (values.length - 1)).toFixed(2) + "," + y(v).toFixed(2); }).join(" "));
    line.setAttribute("fill", "none"); line.setAttribute("class", "record-line");
    line.setAttribute("vector-effect", "non-scaling-stroke"); svg.appendChild(line); box.appendChild(svg);
    var foot = node("div", "chart-foot");
    foot.appendChild(node("span", "", list[0].closed_gmt.slice(0, 10) + " · 0"));
    foot.appendChild(node("span", "", list[list.length - 1].closed_gmt.slice(0, 10) + " · " + points(total)));
    box.appendChild(foot); parent.appendChild(box);
  }
  function draw(data) {
    view.replaceChildren();
    var total = 0, holds = 0, best = null, buys = 0, today = 0;
    rows.forEach(function (t) {
      total += t.result_points; holds += t.hold_minutes;
      best = best === null ? t.result_points : Math.max(best, t.result_points);
      if (t.side === "BUY") buys++;
      if (t.closed_gmt.slice(0, 10) === data.generated_gmt.slice(0, 10)) today++;
    });
    var figures = node("div", "figures");
    metric(figures, words("展示记录累计点数", "Total points in displayed records"), points(total), "recordPoints", true);
    metric(figures, words("展示已平仓（笔）", "Displayed closed trades"), number(rows.length), "recordCount", true);
    view.appendChild(figures); drawCurve(view, rows, total);
    var summary = node("div", "row");
    metric(summary, words("平均每笔（点）", "Mean move (points)"), rows.length ? points(total / rows.length) : "—", "recordAverage");
    metric(summary, words("最大单笔（点）", "Largest move (points)"), points(best), "recordBest");
    metric(summary, words("今日展示平仓（GMT）", "Displayed closes today (GMT)"), number(today), "recordToday");
    metric(summary, words("买入 / 卖出", "Buy / Sell"), buys + " / " + (rows.length - buys), "recordSides");
    metric(summary, words("平均持仓时长", "Mean holding time"), rows.length ? minute(holds / rows.length) : "—", "recordHold");
    metric(summary, words("本期全部已平仓", "All current-period closes"), number(data.trades_total), "recordCurrentCount");
    view.appendChild(summary);
    // Genuine account percentages stay in the same section, explicitly scoped
    // to the reset period, not recomputed from the filtered historical sample.
    var account = node("div", "record-account");
    account.appendChild(node("p", "scope", words("本期账户指标 · ", "Current-period account metrics · ") +
      (data.record_since_gmt ? stamp(data.record_since_gmt) + " GMT" : words("自记录开始", "Since inception"))));
    var metrics = node("div", "row");
    metric(metrics, words("近 1 月收益", "1-month return"), percent(data.return_1m), "recordRet1");
    metric(metrics, words("近 3 月收益", "3-month return"), percent(data.return_3m), "recordRet3");
    metric(metrics, words("近 12 月收益", "12-month return"), percent(data.return_12m), "recordRet12");
    metric(metrics, words("最大已平仓回撤", "Max closed-trade drawdown"), data.trades_total ? percent(-Math.abs(data.max_drawdown)) : "—", "recordMaxDD");
    metric(metrics, words("当前已平仓回撤", "Current closed-trade drawdown"), data.trades_total ? percent(-Math.abs(data.current_drawdown)) : "—", "recordCurrentDD");
    metric(metrics, words("本期胜率", "Current-period win rate"), finite(data.win_rate) ? number(data.win_rate) + "%" : "—", "recordWinRate");
    if (data.trades_total === 0) {
      account.replaceChildren(node("p", "scope", words("重置后尚无已平仓交易，账户指标将在首笔平仓后更新。", "No post-reset trades have closed yet; account metrics will appear after the first close.")));
    } else account.appendChild(metrics);
    view.appendChild(account);
    var ledger = node("div", "ledger");
    ledger.appendChild(node("div", "chart-head", words("最近已平仓交易", "Recent closed trades")));
    var scroll = node("div", "record-table-wrap");
    var table = node("table", "trades"), head = node("thead"), hr = node("tr");
    [words("平仓时间 (GMT)", "Closed (GMT)"), words("方向", "Side"), words("持仓时长", "Holding time"), words("价格变动（点）", "Move (points)")].forEach(function (text, i) {
      var th = node("th", i === 3 ? "r" : "", text); th.scope = "col"; hr.appendChild(th);
    });
    head.appendChild(hr); table.appendChild(head);
    var body = node("tbody", "", undefined, "recordTradesBody");
    rows.slice().reverse().slice(0, limit).forEach(function (t) {
      var tr = node("tr");
      [stamp(t.closed_gmt), t.side, minute(t.hold_minutes), points(t.result_points)].forEach(function (text, i) {
        var cls = i === 1 ? (t.side === "BUY" ? "buy" : "sell") : i === 3 ? "r " + (t.result_points >= 0 ? "pos" : "neg") : "";
        tr.appendChild(node("td", cls, text));
      }); body.appendChild(tr);
    });
    if (!rows.length) { var empty = node("td", "scope", words("暂无已平仓交易。", "No closed trades yet.")); empty.colSpan = 4; var tr = node("tr"); tr.appendChild(empty); body.appendChild(tr); }
    table.appendChild(body); scroll.appendChild(table); ledger.appendChild(scroll);
    ledger.appendChild(node("p", "scope", words("已显示 ", "Showing ") + Math.min(limit, rows.length) + " / " + rows.length, "recordShown"));
    if (limit < rows.length) {
      var more = node("button", "record-more", words("显示更多交易", "Show more trades"), "recordMore");
      more.type = "button"; more.addEventListener("click", function () {
        var previous = limit; limit += 12; draw(last);
        var firstNew = document.querySelectorAll("#recordTradesBody tr")[previous];
        if (firstNew) { firstNew.tabIndex = -1; firstNew.focus({ preventScroll: true }); }
        window.dispatchEvent(new Event("resize"));
      }); ledger.appendChild(more);
    }
    view.appendChild(ledger);
  }
  function render(data, cached) {
    if (!data || data.schema !== "rionea99.status/1" || !isFinite(Date.parse(data.generated_gmt))) throw new Error("Invalid status");
    if (last && Date.parse(data.generated_gmt) < Date.parse(last.generated_gmt)) data = last;
    last = data; var selected = select(data); rows = selected.rows;
    if (cutoff !== data.record_since_gmt) { limit = 12; cutoff = data.record_since_gmt; }
    message.textContent = (cached ? words("暂时无法更新，显示缓存。", "Cannot refresh; showing cached data. ") : "") +
      (selected.hasOld ? words("口径：重置前仅保留盈利记录，重置后保留全部已平仓交易；点数按平仓顺序相加、未按仓位加权，不代表完整账户收益。", "Scope: pre-reset winning trades plus all post-reset closed trades. Points are summed by close time without size weighting, not a complete account return.")
        : words("口径：本期已提供的已平仓明细；点数按平仓顺序相加、未按仓位加权，不是账户收益率。", "Scope: supplied current-period closed trades. Points are summed by close time without size weighting, not account returns.")) +
      (selected.issues.length ? " " + selected.issues.join(" ") : "");
    draw(data); window.dispatchEvent(new Event("resize"));
  }
  function load() {
    if (busy) return; busy = true;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;
    var options = { cache: "no-store" }; if (controller) options.signal = controller.signal;
    fetch(url, options).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        render(data, false);
        try { localStorage.setItem(CACHE, JSON.stringify(last)); } catch (e) {}
      }).catch(function () {
        var saved = last;
        if (!saved) try { saved = JSON.parse(localStorage.getItem(CACHE) || "null"); } catch (e) {}
        try { if (saved) { render(saved, true); return; } } catch (e) {}
        message.textContent = words("暂时无法读取交易记录，请刷新重试。", "Trade records are unavailable. Refresh to retry.");
      }).then(function () { clearTimeout(timer); busy = false; });
  }
  load();
  setInterval(function () { if (!document.hidden) load(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
