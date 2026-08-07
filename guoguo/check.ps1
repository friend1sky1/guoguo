# 果果的早教小站 · 无头验证（JScript 引擎）
# 注意：JScriptEvaluate 每次调用是独立编译单元，编译期检查自由变量，
# 所以"加载"与"断言"必须合并进同一次 eval —— 本脚本一次 eval 全部代码。
# 用法：powershell -File check.ps1
Add-Type -AssemblyName Microsoft.JScript

$root = Join-Path $PSScriptRoot 'js'
$data = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'data.js')
$app  = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'app.js')

# 桩环境：document / localStorage / window / JSON（JScript 无原生 JSON）
$stub = @'
function Stub() {}
Stub.prototype.addEventListener = function () {};
Stub.prototype.focus = function () {};
Stub.prototype.select = function () {};
Stub.prototype.querySelectorAll = function () { return []; };
Stub.prototype.querySelector = function () { return new Stub(); };
Stub.prototype.closest = function () { return null; };
Stub.prototype.classList = { add: function () {}, remove: function () {} };
Stub.prototype.style = {};
Stub.prototype.dataset = {};
var JSON = {
  parse: function (s) { return (new Function("return (" + s + ");"))(); },
  stringify: function (o) {
    function esc(s) { return String(s).replace(/"/g, '\\"'); }
    var parts = [];
    for (var k in o) {
      var v = o[k];
      if (typeof v === "object" && v !== null) {
        parts.push('"' + esc(k) + '":' + JSON.stringify(v));
      } else {
        parts.push('"' + esc(k) + '":"' + esc(v) + '"');
      }
    }
    return "{" + parts.join(",") + "}";
  }
};
var __ls = {};
var localStorage = {
  getItem: function (k) { return (k in __ls) ? __ls[k] : null; },
  setItem: function (k, v) { __ls[k] = String(v); },
  removeItem: function (k) { delete __ls[k]; }
};
var __els = {};
var document = {
  getElementById: function (id) { if (!__els[id]) __els[id] = new Stub(); return __els[id]; },
  querySelectorAll: function () { return []; },
  querySelector: function () { return new Stub(); },
  addEventListener: function () {},
  body: { style: {} }
};
var navigator = {};
var window = { scrollTo: function () {}, onload: null };
'@

# 自包含断言：加载后立即执行，结果以 | 分隔返回
$assert = @'
(function () {
  var R = [];
  function plan(d) {
    var p = getPlan(d);
    return p.week + ":" + p.poem.title + "+" + p.song.title + ":" + p.source;
  }
  /* 数据与轮换池 */
  R.push("type=" + typeof CONTENT);
  R.push("pool=" + ROTATION_POOLS.poems.length + ":" + ROTATION_POOLS.songs.length + ":" + ROTATION_POOLS.lullabies.length);
  R.push("fixed=" + FIXED_SCHEDULE.length);
  /* 前 8 周固定排期 */
  R.push(plan("2026-08-07"));
  R.push(plan("2026-08-13"));
  R.push(plan("2026-08-14"));
  R.push(plan("2026-08-28"));
  R.push(plan("2026-09-04"));
  R.push(plan("2026-09-11"));
  R.push(plan("2026-09-18"));
  R.push(plan("2026-09-25"));
  R.push(plan("2026-10-02"));
  /* 自动轮换 */
  R.push(plan("2026-10-09"));
  R.push(plan("2026-10-16"));
  R.push(plan("2027-01-08"));
  /* 手动换组 */
  clearOverride("2026-08-07"); swapToday("2026-08-07");
  R.push(plan("2026-08-07"));
  clearOverride("2026-08-07");
  R.push(plan("2026-08-07"));
  /* 专注模式执行无异常 */
  R.push("focus=" + (function () {
    openFocus("诗", "《静夜思》", "李白", "床前明月光，疑是地上霜。");
    closeFocus();
    return "ok";
  })());
  /* 留言板执行无异常 */
  R.push("suggest=" + (function () {
    renderSettings();
    __els["suggest-input"].value = "昨晚念咏鹅果果笑了";
    saveSuggest();
    copySuggest();
    return __ls["guoguo.suggest"] === "昨晚念咏鹅果果笑了" ? "ok" : "no";
  })());
  renderSchedule();
  var schedHtml = __els["sched-table"] ? __els["sched-table"].innerHTML : "";
  R.push("sched-lul=" + (schedHtml.indexOf("晚安曲") >= 0 ? "y" : "n"));
  R.push("sched-lul1=" + (schedHtml.indexOf("摇篮曲") >= 0 ? "y" : "n"));
  /* 锚点修改 */
  setWeekStart("2026-09-01");
  R.push(plan("2026-09-08"));
  setWeekStart("2026-08-07");
  return R.join("|");
})()
'@

$expect = @(
  "type=object",
  "pool=14:40:7",
  "fixed=8",
  "1:静夜思+小星星:fixed",
  "1:静夜思+小星星:fixed",
  "2:静夜思+小星星:fixed",
  "4:春晓+两只老虎:fixed",
  "5:登鹳雀楼+小白兔白又白:fixed",
  "6:画+虫虫飞:fixed",
  "7:鹿柴+摇摇摇（外婆桥）:fixed",
  "8:山村咏怀+丢手绢:fixed",
  "9:静夜思+小星星:auto",
  "10:咏鹅+小兔子乖乖:auto",
  "11:春晓+两只老虎:auto",
  "23:静夜思+蜗牛与黄鹂鸟:auto",
  "1:咏鹅+小兔子乖乖:override",
  "1:静夜思+小星星:fixed",
  "focus=ok",
  "suggest=ok",
  "sched-lul=y",
  "sched-lul1=y",
  "2:静夜思+小星星:fixed"
)

$engine = [Microsoft.JScript.Vsa.VsaEngine]::CreateEngine()
try {
  $result = [Microsoft.JScript.Eval]::JScriptEvaluate($stub + "`n" + $data + "`n" + $app + "`n" + $assert, $engine)
} catch {
  Write-Host "FAIL  加载或断言执行异常: $($_.Exception.Message)"
  exit 1
}

$actual = ($result -split "\|")
Write-Host "== 断言结果（$($expect.Count) 项）=="
$fail = 0
for ($i = 0; $i -lt $expect.Count; $i++) {
  $a = if ($i -lt $actual.Count) { $actual[$i] } else { "<缺失>" }
  if ($a -eq $expect[$i]) { Write-Host "PASS  $($expect[$i])" }
  else { Write-Host "FAIL  #$($i+1) 实际=[$a] 期望=[$($expect[$i])]"; $fail++ }
}
if ($fail -eq 0) { Write-Host "`n全部通过 ✔" } else { Write-Host "`n$fail 项失败 ✘"; exit 1 }
