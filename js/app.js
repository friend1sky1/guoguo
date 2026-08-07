/* ============================================================
 * 果果的早教小站 · 逻辑
 * 今日调度：前 8 周固定排期 → 第 9 周起自动轮换
 * 本地存储键：guoguo.fs / guoguo.theme / guoguo.weekStart / guoguo.override
 * 兼容性：纯 ES5（老手机 / 微信内置浏览器均可运行）
 * ============================================================ */
"use strict";

/* ---------------- 小工具 ---------------- */

function $(id) { return document.getElementById(id); }

var LS = {
  "get": function (key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  },
  "set": function (key, val) { try { localStorage.setItem(key, val); } catch (e) { } },
  "del": function (key) { try { localStorage.removeItem(key); } catch (e) { } }
};

/* 'YYYY-MM-DD' → Date（本地时区，避免解析偏移） */
function parseDate(str) {
  var parts = str.split("-");
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}

function fmtDate(d) {
  var week = ["日", "一", "二", "三", "四", "五", "六"];
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + week[d.getDay()];
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function toStr(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function todayStr() { return toStr(new Date()); }

function diffDays(a, b) {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
     Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000
  );
}

function addDays(str, n) {
  var d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toStr(d);
}

/* ---------------- 内容查找 ---------------- */

function findIn(cat, title) {
  var arr = CONTENT[cat];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].title === title) return arr[i];
  }
  return null;
}

/* 歌/谣混合查找：先儿歌后童谣 */
function findSong(title) {
  return findIn("songs", title) || findIn("nursery", title);
}

function findById(id) {
  var cats = ["poems", "songs", "nursery", "lullabies"];
  for (var c = 0; c < cats.length; c++) {
    var arr = CONTENT[cats[c]];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return arr[i];
    }
  }
  return null;
}

/* ---------------- 设置存取 ---------------- */

function getWeekStart() {
  var v = LS.get("guoguo.weekStart", DEFAULT_WEEK_START);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return DEFAULT_WEEK_START;
  var d = parseDate(v);
  if (isNaN(d.getTime())) return DEFAULT_WEEK_START;
  return v;
}
function setWeekStart(v) { LS.set("guoguo.weekStart", v); }

function getOverride(dateStr) {
  var raw = LS.get("guoguo.override", "{}");
  try { var obj = JSON.parse(raw); return obj[dateStr] || null; } catch (e) { return null; }
}

function setOverride(dateStr, plan) {
  var raw = LS.get("guoguo.override", "{}");
  var obj;
  try { obj = JSON.parse(raw); } catch (e) { obj = {}; }
  obj[dateStr] = plan;
  LS.set("guoguo.override", JSON.stringify(obj));
}

function clearOverride(dateStr) {
  var raw = LS.get("guoguo.override", "{}");
  var obj;
  try { obj = JSON.parse(raw); } catch (e) { obj = {}; }
  delete obj[dateStr];
  LS.set("guoguo.override", JSON.stringify(obj));
}

/* ---------------- 今日组合调度 ---------------- */

function getPlan(dateStr) {
  var start = parseDate(getWeekStart());
  var today = parseDate(dateStr);
  var weekIndex = Math.floor(diffDays(start, today) / 7);
  var future = weekIndex < 0;
  if (weekIndex < 0) weekIndex = 0;
  if (isNaN(weekIndex)) { weekIndex = 0; future = false; }

  var ovr = getOverride(dateStr);
  var poem, song, source;
  if (ovr) {
    poem = findById(ovr.poemId);
    song = findById(ovr.songId);
    source = "override";
  } else if (weekIndex < FIXED_SCHEDULE.length) {
    var row = FIXED_SCHEDULE[weekIndex];
    poem = findIn("poems", row.poem);
    song = findSong(row.song);
    source = "fixed";
  } else {
    var k = weekIndex - FIXED_SCHEDULE.length;
    poem = ROTATION_POOLS.poems[k % ROTATION_POOLS.poems.length];
    song = ROTATION_POOLS.songs[k % ROTATION_POOLS.songs.length];
    source = "auto";
  }

  var lullaby = ROTATION_POOLS.lullabies[weekIndex % ROTATION_POOLS.lullabies.length];
  return { week: weekIndex + 1, poem: poem, song: song, lullaby: lullaby, source: source, future: future };
}

/* 换一组：诗、歌各自在轮换池中后移一位（当晚生效，存 override） */
function swapToday(dateStr) {
  var plan = getPlan(dateStr);
  var poolPoems = ROTATION_POOLS.poems;
  var poolSongs = ROTATION_POOLS.songs;
  var pi = -1, si = -1, i;
  for (i = 0; i < poolPoems.length; i++) { if (poolPoems[i].id === plan.poem.id) { pi = i; break; } }
  for (i = 0; i < poolSongs.length; i++) { if (poolSongs[i].id === plan.song.id) { si = i; break; } }
  if (pi < 0) pi = 0;
  if (si < 0) si = 0;
  setOverride(dateStr, {
    poemId: poolPoems[(pi + 1) % poolPoems.length].id,
    songId: poolSongs[(si + 1) % poolSongs.length].id
  });
}

/* ---------------- 今日页渲染 ---------------- */

var preview = null; /* null | 'tomorrow' */

function renderToday() {
  var dateStr = preview === "tomorrow" ? addDays(todayStr(), 1) : todayStr();
  var plan = getPlan(dateStr);
  var isTomorrow = preview === "tomorrow";

  $("today-week").textContent = isTomorrow ? "明日预览" : "第 " + plan.week + " 周";
  $("today-date").textContent = fmtDate(parseDate(dateStr)) + (plan.future ? "（周计划起点在未来）" : "");
  $("hello-sub").textContent = "每天 20:00 · 3–5 分钟 · 1 诗 + 1 歌，重在每天在场";

  $("poem-title").textContent = "《" + plan.poem.title + "》";
  $("poem-author").textContent = plan.poem.author || "";
  $("poem-text").textContent = plan.poem.text;
  $("poem-tips").textContent = plan.poem.tips;

  $("song-title").textContent = "《" + plan.song.title + "》";
  $("song-text").textContent = plan.song.text;
  $("song-tips").textContent = plan.song.tips;

  $("lul-title").textContent = "《" + plan.lullaby.title + "》";
  $("lul-text").textContent = plan.lullaby.text;
  $("lul-tips").textContent = plan.lullaby.tips;

  var stepsHtml = "";
  for (var i = 0; i < NIGHT_STEPS.length; i++) {
    stepsHtml += "<li>" + NIGHT_STEPS[i] + "</li>";
  }
  $("night-steps").innerHTML = stepsHtml;

  var swapBtn = $("btn-swap");
  swapBtn.textContent = plan.source === "override" ? "再换一组（今晚用）" : "换一组（今晚用）";

  $("btn-tomorrow").textContent = isTomorrow ? "回到今天" : "看看明天";
}

/* ---------------- 内容库渲染 ---------------- */

var CATS = [
  { key: "poems", label: "诗" },
  { key: "songs", label: "儿歌" },
  { key: "nursery", label: "童谣" },
  { key: "lullabies", label: "晚安曲" }
];

var currentCat = "poems";

function badgeOf(item) {
  var parts = [];
  if (item.star) parts.push('<span class="badge star">⭐ 已定</span>');
  if (item.stage === "adv") parts.push('<span class="badge later">进阶</span>');
  if (item.stage === "later") parts.push('<span class="badge later">后段再入</span>');
  return parts.join("");
}

function renderLib() {
  var arr = CONTENT[currentCat];
  var html = "";
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    html += '<li class="lib-item" data-id="' + it.id + '">' +
            '<span class="t">' + it.title + '</span>' +
            '<span class="a">' + (it.author || "") + '</span>' +
            badgeOf(it) +
            "</li>";
  }
  $("lib-list").innerHTML = html;
}

function openModal(item, kindLabel) {
  $("m-kind").textContent = kindLabel;
  $("m-title").textContent = "《" + item.title + "》";
  $("m-author").textContent = item.author || "";
  $("m-text").textContent = item.text;
  $("m-tips").textContent = "怎么读：" + item.tips;
  $("modal-mask").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  $("modal-mask").hidden = true;
  document.body.style.overflow = "";
}

/* ---------------- 全屏专注模式 ---------------- */

var focusFullscreen = false;

function openFocus(kind, title, author, text) {
  $("focus-kind").textContent = kind;
  $("focus-title").textContent = title;
  $("focus-author").textContent = author || "";
  $("focus-text").textContent = text;
  $("focus-mask").hidden = false;
  document.body.style.overflow = "hidden";
  /* 尽力尝试真全屏（不支持时遮罩本身就是全屏） */
  var el = $("focus-mask");
  if (el.requestFullscreen) {
    focusFullscreen = true;
    var p = el.requestFullscreen();
    if (p && p.then) p.then(null, function () { /* 被拒绝则仅用遮罩 */ });
  } else if (el.webkitRequestFullscreen) {
    focusFullscreen = true;
    el.webkitRequestFullscreen();
  }
}

function closeFocus() {
  $("focus-mask").hidden = true;
  document.body.style.overflow = "";
  if (focusFullscreen) {
    focusFullscreen = false;
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

function bindFocus() {
  /* [正文id, 类别, 标题id, 作者id] */
  var pairs = [
    ["poem-text", "诗", "poem-title", "poem-author"],
    ["song-text", "儿歌/童谣", "song-title", ""],
    ["lul-text", "晚安曲", "lul-title", ""]
  ];
  for (var i = 0; i < pairs.length; i++) {
    (function (p) {
      $(p[0]).addEventListener("click", function () {
        openFocus(p[1], $(p[2]).textContent, p[3] ? $(p[3]).textContent : "", $(p[0]).textContent);
      });
    })(pairs[i]);
  }
  $("focus-mask").addEventListener("click", closeFocus);
  /* 用户用系统手势退出全屏时，同步关掉遮罩（标准 + WebKit 事件） */
  function onFullscreenChange() {
    var el = document.fullscreenElement || document.webkitFullscreenElement;
    if (focusFullscreen && !el) {
      focusFullscreen = false;
      $("focus-mask").hidden = true;
      document.body.style.overflow = "";
    }
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
}

/* ---------------- 屏幕常亮（Wake Lock） ---------------- */

var wakeLockRef = null;

function requestWakeLock() {
  if (!navigator.wakeLock || !navigator.wakeLock.request) return;
  try {
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLockRef = lock;
    }, function () { /* 被拒绝则静默 */ });
  } catch (e) { /* 忽略 */ }
}

function bindWakeLock() {
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") requestWakeLock();
  });
}

/* ---------------- 排期页渲染 ---------------- */

function renderSchedule() {
  var plan = getPlan(todayStr());
  var luls = ROTATION_POOLS.lullabies;
  var html = "<thead><tr><th>周</th><th>诗</th><th>儿歌/童谣</th><th>晚安曲（可选）</th></tr></thead><tbody>";
  for (var i = 0; i < FIXED_SCHEDULE.length; i++) {
    var row = FIXED_SCHEDULE[i];
    var cur = plan.source === "fixed" && row.week === plan.week ? ' class="current"' : "";
    html += "<tr" + cur + "><td>第 " + row.week + " 周</td>" +
            "<td>《" + row.poem + "》</td><td>《" + row.song + "》</td>" +
            "<td>《" + luls[(row.week - 1) % luls.length].title + "》</td></tr>";
  }
  /* 汇总行：固定阶段不高亮，标注第 9 周起；自动阶段高亮当前周 */
  var lul9 = luls[8 % luls.length].title;
  if (plan.source === "auto") {
    html += '<tr class="current"><td>第 ' + plan.week + ' 周起</td>' +
            '<td colspan="2">诗和歌谣每周各换一首</td>' +
            '<td>《' + luls[(plan.week - 1) % luls.length].title + '》</td></tr>';
  } else {
    html += '<tr><td>第 9 周起</td>' +
            '<td colspan="2">诗和歌谣每周各换一首</td>' +
            '<td>《' + lul9 + '》</td></tr>';
  }
  html += "</tbody>";
  $("sched-table").innerHTML = html;
  $("schedule-now-week").textContent = "今天是第 " + plan.week + " 周";
  /* 下周预告 */
  var next = getPlan(addDays(todayStr(), 7));
  $("sched-next").innerHTML = "下周（第 " + next.week + " 周）：《" + next.poem.title + "》+《" + next.song.title + "》 · 晚安曲《" + next.lullaby.title + "》";
}

/* ---------------- 设置页渲染 ---------------- */

function renderSettings() {
  $("set-weekstart").value = getWeekStart();
  var html = "";
  for (var i = 0; i < READING_TIPS.length; i++) {
    html += "<li><b>" + READING_TIPS[i].name + "</b>：" + READING_TIPS[i].desc + "</li>";
  }
  $("reading-tips").innerHTML = html;
  $("suggest-input").value = LS.get("guoguo.suggest", "");
}

/* ---------------- 留言板 ---------------- */

function flashStatus(msg) {
  $("suggest-status").textContent = msg;
}

function saveSuggest() {
  var v = $("suggest-input").value;
  if (!v) { flashStatus("先写点内容再存哦"); return; }
  LS.set("guoguo.suggest", v);
  flashStatus("已存到本机，下次打开还在 ✓");
}

function fallbackCopy(ta) {
  try {
    ta.focus();
    ta.select();
    if (document.execCommand) return document.execCommand("copy");
  } catch (e) { /* 忽略 */ }
  return false;
}

function copySuggest() {
  var ta = $("suggest-input");
  if (!ta.value) { flashStatus("先写点内容再复制哦"); return; }
  var doneOk = function () { flashStatus("已复制，去微信发给果果爸爸吧 ✓"); };
  var doneFail = function () { flashStatus("复制失败，请长按文字手动复制"); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      navigator.clipboard.writeText(ta.value).then(doneOk, doneFail);
    } catch (e) { doneFail(); }
  } else {
    if (fallbackCopy(ta)) doneOk(); else doneFail();
  }
}

/* ---------------- 主题与字号 ---------------- */

function applyTheme() {
  var t = LS.get("guoguo.theme", "auto");
  var html = document.documentElement;
  if (t === "dark") html.dataset.theme = "dark";
  else if (t === "light") html.dataset.theme = "light";
  else delete html.dataset.theme;
  $("btn-theme").textContent = t === "light" ? "☀️" : t === "dark" ? "🌙" : "🌗";
  /* 状态栏颜色跟随主题 */
  var isDark = t === "dark";
  if (t === "auto" && window.matchMedia) isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark ? "#1f2933" : "#f7f3ea";
}

function cycleTheme() {
  var order = ["auto", "light", "dark"];
  var cur = LS.get("guoguo.theme", "auto");
  var idx = 0, i;
  for (i = 0; i < order.length; i++) { if (order[i] === cur) { idx = i; break; } }
  var next = order[(idx + 1) % order.length];
  LS.set("guoguo.theme", next);
  applyTheme();
}

function applyFont() {
  var pct = parseInt(LS.get("guoguo.fs", "100"), 10);
  if (isNaN(pct)) pct = 100;
  if (pct < 70) pct = 70;
  if (pct > 150) pct = 150;
  document.documentElement.style.fontSize = (16 * pct / 100) + "px";
}

function bumpFont(delta) {
  var pct = parseInt(LS.get("guoguo.fs", "100"), 10) + delta;
  if (pct < 70) pct = 70;
  if (pct > 150) pct = 150;
  LS.set("guoguo.fs", String(pct));
  applyFont();
}

/* ---------------- Tab 切换 ---------------- */

function switchView(name) {
  var views = document.querySelectorAll(".view");
  for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
  var tabs = document.querySelectorAll(".tab");
  for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove("active");
  $("view-" + name).classList.add("active");
  document.querySelector('.tab[data-view="' + name + '"]').classList.add("active");
  window.scrollTo(0, 0);
  if (name === "library") renderLib();
  if (name === "schedule") renderSchedule();
  if (name === "settings") renderSettings();
}

/* ---------------- 按钮与事件绑定 ---------------- */

function bind() {
  $("tabs").addEventListener("click", function (e) {
    var tab = e.target.closest ? e.target.closest(".tab") : null;
    if (tab) switchView(tab.dataset.view);
  });

  $("btn-font-plus").addEventListener("click", function () { bumpFont(10); });
  $("btn-font-minus").addEventListener("click", function () { bumpFont(-10); });
  $("btn-theme").addEventListener("click", cycleTheme);

  $("btn-swap").addEventListener("click", function () {
    var dateStr = preview === "tomorrow" ? addDays(todayStr(), 1) : todayStr();
    swapToday(dateStr);
    renderToday();
  });

  $("btn-tomorrow").addEventListener("click", function () {
    preview = preview === "tomorrow" ? null : "tomorrow";
    renderToday();
  });

  $("lib-tabs").addEventListener("click", function (e) {
    var tab = e.target.closest ? e.target.closest(".lib-tab") : null;
    if (!tab) return;
    currentCat = tab.dataset.cat;
    var tabs = document.querySelectorAll(".lib-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
    tab.classList.add("active");
    renderLib();
  });

  $("lib-list").addEventListener("click", function (e) {
    var item = e.target.closest ? e.target.closest(".lib-item") : null;
    if (!item) return;
    var it = findById(item.dataset.id);
    if (!it) return;
    var kind = "";
    for (var i = 0; i < CATS.length; i++) {
      if (CATS[i].key === currentCat) { kind = CATS[i].label; break; }
    }
    openModal(it, kind);
  });

  $("modal-close").addEventListener("click", closeModal);
  $("modal-mask").addEventListener("click", function (e) {
    if (e.target === $("modal-mask")) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  $("set-weekstart").addEventListener("change", function (e) {
    if (e.target.value) {
      setWeekStart(e.target.value);
      var dateStr = preview === "tomorrow" ? addDays(todayStr(), 1) : todayStr();
      clearOverride(dateStr);
      preview = null;
      renderToday();
      renderSchedule();
    }
  });

  $("btn-reset-today").addEventListener("click", function () {
    var dateStr = preview === "tomorrow" ? addDays(todayStr(), 1) : todayStr();
    clearOverride(dateStr);
    renderToday();
  });

  $("btn-copy-suggest").addEventListener("click", copySuggest);
  $("btn-save-suggest").addEventListener("click", saveSuggest);

  bindFocus();
  bindWakeLock();
}

/* ---------------- 启动 ---------------- */

function initCounts() {
  $("count-poems").textContent = CONTENT.poems.length;
  $("count-songs").textContent = CONTENT.songs.length;
  $("count-nursery").textContent = CONTENT.nursery.length;
  $("count-lullabies").textContent = CONTENT.lullabies.length;
}

function init() {
  applyFont();
  applyTheme();
  initCounts();
  renderToday();
  renderSchedule();
  renderSettings();
  bind();
  requestWakeLock();
}

if (document.addEventListener) {
  document.addEventListener("DOMContentLoaded", init);
} else {
  window.onload = init;
}
