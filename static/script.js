/* =========================================================
   CONFIG — set your deployed FastAPI URL here
   ========================================================= */
// Frontend is served by FastAPI itself (app.mount), so use the same origin.
const API_BASE = "";

/* ========================================================= */
const $ = (id) => document.getElementById(id);

const form = $("form");
const submitBtn = $("submitBtn");
const formError = $("formError");
const resultCard = $("resultCard");
const gaugeFill = $("gaugeFill");
const GAUGE_LEN = 282.74; // pi * r (r = 90)

const numericFields = [
  "person_age", "person_income", "person_emp_length",
  "loan_amnt", "loan_int_rate", "cb_person_cred_hist_length",
];

/* ---------- Segmented control thumb position ---------- */
function syncSegmented(group) {
  const radios = [...group.querySelectorAll("input[type=radio]")];
  const idx = Math.max(0, radios.findIndex((r) => r.checked));
  group.style.setProperty("--i", idx);
}
document.querySelectorAll(".segmented").forEach((g) => {
  syncSegmented(g);
  g.addEventListener("change", () => syncSegmented(g));
});

/* ---------- Auto loan-to-income ratio ---------- */
function updateRatio() {
  const income = parseFloat($("person_income").value);
  const amount = parseFloat($("loan_amnt").value);
  const out = $("loan_percent_income");
  if (income > 0 && amount >= 0) {
    out.value = (amount / income).toFixed(2);
  } else {
    out.value = "";
  }
}
["person_income", "loan_amnt"].forEach((id) => $(id).addEventListener("input", updateRatio));

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => (t.hidden = true), 400);
  }, ms);
}

/* ---------- API status / warm-up ---------- */
async function checkApi() {
  const status = $("status");
  const text = $("statusText");
  status.dataset.state = "checking";
  text.textContent = "Connecting…";
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 45000); // Render free tier cold start
    const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error();
    status.dataset.state = "online";
    text.textContent = "Model online";
  } catch {
    status.dataset.state = "offline";
    text.textContent = "API unreachable";
  }
}
checkApi();

/* ---------- Validation ---------- */
function validate() {
  let ok = true;
  document.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));

  const rules = {
    person_age: (v) => v >= 18 && v <= 100,
    person_income: (v) => v > 0,
    person_emp_length: (v) => v >= 0 && v <= 80,
    loan_amnt: (v) => v > 0,
    loan_int_rate: (v) => v >= 0 && v <= 100,
    cb_person_cred_hist_length: (v) => v >= 0 && v <= 80,
  };

  for (const id of numericFields) {
    const el = $(id);
    const v = parseFloat(el.value);
    if (Number.isNaN(v) || !rules[id](v)) {
      el.closest(".field").classList.add("invalid");
      ok = false;
    }
  }
  return ok;
}

document.querySelectorAll(".input input, .input select").forEach((el) => {
  el.addEventListener("input", () => el.closest(".field")?.classList.remove("invalid"));
});

/* ---------- Build payload ---------- */
function buildPayload() {
  const fd = new FormData(form);
  return {
    person_age: parseInt(fd.get("person_age"), 10),
    person_income: parseFloat(fd.get("person_income")),
    person_home_ownership: fd.get("person_home_ownership"),
    person_emp_length: parseFloat(fd.get("person_emp_length")),
    loan_intent: fd.get("loan_intent"),
    loan_grade: fd.get("loan_grade"),
    loan_amnt: parseFloat(fd.get("loan_amnt")),
    loan_int_rate: parseFloat(fd.get("loan_int_rate")),
    loan_percent_income: parseFloat($("loan_percent_income").value),
    cb_person_default_on_file: fd.get("cb_person_default_on_file"),
    cb_person_cred_hist_length: parseInt(fd.get("cb_person_cred_hist_length"), 10),
  };
}

/* ---------- Submit ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  if (!validate()) {
    formError.textContent = "Please correct the highlighted fields.";
    formError.hidden = false;
    return;
  }

  setLoading(true);
  const slowTimer = setTimeout(
    () => toast("Server is waking up — this can take up to a minute on the first request.", 6000),
    4000
  );

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 70000);
    const res = await fetch(`${API_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
      signal: ctrl.signal,
    });
    clearTimeout(to);

    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const j = await res.json();
        if (Array.isArray(j.detail)) {
          detail = j.detail.map((d) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join(" · ");
        } else if (j.detail) detail = String(j.detail);
      } catch {}
      throw new Error(detail);
    }

    const data = await res.json();
    renderResult(data);
    $("status").dataset.state = "online";
    $("statusText").textContent = "Model online";

    if (window.matchMedia("(max-width: 960px)").matches) {
      resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (err) {
    const msg = err.name === "AbortError" ? "The server took too long to respond." : err.message || "Something went wrong.";
    formError.textContent = msg;
    formError.hidden = false;
    $("status").dataset.state = "offline";
    $("statusText").textContent = "API unreachable";
  } finally {
    clearTimeout(slowTimer);
    setLoading(false);
  }
});

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitBtn.querySelector(".btn-label").textContent = on ? "Analysing" : "Assess risk";
}

/* ---------- Render result ---------- */
function renderResult(data) {
  // NOTE: backend key is spelled "default_predicition"
  const prob = Number(data.default_probability);
  const threshold = Number(data.threshold);
  const pred = data.default_predicition ?? data.default_prediction;
  const isHigh = Number(pred) === 1;

  // gauge arc
  const clamped = Math.min(Math.max(prob, 0), 1);
  gaugeFill.style.strokeDashoffset = GAUGE_LEN * (1 - clamped);

  // threshold tick
  const t = Math.min(Math.max(threshold, 0), 1);
  const cx = 110, cy = 110;
  const ang = Math.PI * t;
  const pt = (r) => [cx - r * Math.cos(ang), cy - r * Math.sin(ang)];
  const [x1, y1] = pt(80);
  const [x2, y2] = pt(102);
  const tick = $("tickLine");
  tick.setAttribute("x1", x1); tick.setAttribute("y1", y1);
  tick.setAttribute("x2", x2); tick.setAttribute("y2", y2);
  $("thresholdTick").setAttribute("opacity", "1");

  // count-up
  countUp($("pctValue"), prob * 100, 1400);

  // state + verdict
  resultCard.dataset.state = isHigh ? "high" : "low";
  void resultCard.offsetWidth;
  resultCard.dataset.state = isHigh ? "high" : "low";
  const verdict = $("verdict");
  verdict.style.animation = "none"; void verdict.offsetWidth; verdict.style.animation = "pop 0.5s var(--ease)";
  $("verdictText").textContent = data.Result || (isHigh ? "High Risk" : "Low Risk");

  $("resultSub").textContent = isHigh
    ? "The applicant's estimated default probability exceeds the decision threshold."
    : "The applicant's estimated default probability is below the decision threshold.";

  // facts
  const margin = (prob - threshold) * 100;
  setFact("factThreshold", `${(threshold * 100).toFixed(1)}%`);
  setFact("factPrediction", isHigh ? "1 · Default" : "0 · No default");
  setFact("factLti", $("loan_percent_income").value || "—");
  setFact("factMargin", `${margin > 0 ? "+" : ""}${margin.toFixed(1)} pts`);
}

function setFact(id, value) {
  const el = $(id);
  el.textContent = value;
  el.classList.remove("swap");
  void el.offsetWidth;
  el.classList.add("swap");
}

function countUp(el, target, duration) {
  const start = performance.now();
  const from = parseFloat(el.textContent) || 0;
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  function frame(now) {
    const p = Math.min((now - start) / duration, 1);
    el.textContent = (from + (target - from) * ease(p)).toFixed(1);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ---------- Sample / Reset ---------- */
$("fillBtn").addEventListener("click", () => {
  const sample = {
    person_age: 27, person_income: 58000, person_home_ownership: "RENT",
    person_emp_length: 4, loan_intent: "EDUCATION", loan_amnt: 12000,
    loan_int_rate: 11.5, cb_person_cred_hist_length: 4,
  };
  Object.entries(sample).forEach(([k, v]) => ($(k).value = v));
  $("g-C").checked = true;
  $("d-N").checked = true;
  document.querySelectorAll(".segmented").forEach(syncSegmented);
  document.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
  updateRatio();
  toast("Sample applicant loaded");
});

$("resetBtn").addEventListener("click", () => {
  form.reset();
  $("g-B").checked = true;
  document.querySelectorAll(".segmented").forEach(syncSegmented);
  document.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
  formError.hidden = true;
  updateRatio();

  gaugeFill.style.strokeDashoffset = GAUGE_LEN;
  $("thresholdTick").setAttribute("opacity", "0");
  $("pctValue").textContent = "0.0";
  resultCard.dataset.state = "idle";
  $("verdictText").textContent = "Awaiting input";
  $("resultSub").textContent = "Results appear here after you run an assessment.";
  ["factThreshold", "factPrediction", "factLti", "factMargin"].forEach((id) => ($(id).textContent = "—"));
});
