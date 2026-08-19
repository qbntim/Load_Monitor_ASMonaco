"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowLeft, Check, Download, Lock, Moon, Plus, TrendingUp,
  Trash2, Users, X, Zap, BarChart3, ChevronDown, ChevronUp, LogOut, KeyRound,
} from "lucide-react";

// ---------- design tokens: AS Monaco red & white ----------
const C = {
  bg: "#F7F4F1",
  surface1: "#FFFFFF",
  surface2: "#F2EEEA",
  border: "#E4DDD5",
  borderStrong: "#CFC4B8",
  text: "#201A16",
  textMuted: "#847A70",
  onRed: "#FFFFFF",
  accent: "#C8102E",
  accentDark: "#8C0C22",
  brand: "#8C0C22",
  green: "#1F7A47",
  greenDark: "#E3F3E9",
  amber: "#9A6A0C",
  amberDark: "#FBF0D9",
  red: "#A82A22",
  redDark: "#FBE5E2",
  blue: "#2A5FAD",
  blueDark: "#E6EEFA",
  slate: "#5B6B7A",
  sand: "#C8A24A",
  teal: "#2E8E77",
};

const LOAD_TYPES = [
  { key: "Volleyball Practice", short: "Volleyball", color: C.slate },
  { key: "Beach Volleyball Practice", short: "Beach VB", color: C.sand },
  { key: "Strength & Conditioning", short: "S&C", color: "#7A5C8C" },
  { key: "Game", short: "Game", color: C.accent },
  { key: "Recovery", short: "Recovery", color: C.teal },
];
const typeColor = (t) => (LOAD_TYPES.find((x) => x.key === t) || {}).color || C.textMuted;

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600;700&display=swap');
`;
const fontDisplay = "'Space Grotesk', sans-serif";
const fontBody = "'Inter', sans-serif";
const fontMono = "'JetBrains Mono', monospace";

// ---------- storage helpers (talk to our own /api/kv route, backed by Upstash Redis) ----------
async function getJSON(key, fallback) {
  try {
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`);
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.value ? JSON.parse(data.value) : fallback;
  } catch (e) {
    return fallback;
  }
}
async function setJSON(key, value) {
  try {
    const res = await fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: JSON.stringify(value) }),
    });
    return res.ok;
  } catch (e) {
    console.error("Save failed", e);
    return false;
  }
}

// tiny non-cryptographic hash, just to avoid storing PINs as plain text
function hashPin(pin) {
  let h = 5381;
  for (let i = 0; i < pin.length; i++) h = ((h * 33) ^ pin.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDateShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
}

const RPE_LABELS = {
  0: "Rest", 1: "Very light", 2: "Light", 3: "Moderate", 4: "Somewhat hard",
  5: "Hard", 6: "Hard", 7: "Very hard", 8: "Very hard", 9: "Very hard", 10: "Maximal",
};

function normalizeRoster(raw) {
  // supports legacy plain-string roster entries with no PIN
  return (raw || []).map((item) =>
    typeof item === "string" ? { name: item, pinHash: null } : item
  );
}

// ---------- load metric computation ----------
// entries: session logs (date, type, rpe, duration, load) — multiple per day allowed (two-a-days)
// wellness: one morning check-in per day (date, sleep, soreness, mood, stress)
function computeMetrics(entries, wellnessEntries = []) {
  const days = 28;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dailyLoad = [];
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const iso = d.toISOString().slice(0, 10);
    dates.push(iso);
    const dayTotal = entries.filter((x) => x.date === iso).reduce((a, e) => a + e.load, 0);
    dailyLoad.push(dayTotal);
  }
  const last7 = dailyLoad.slice(-7);
  const weeklyLoad = last7.reduce((a, b) => a + b, 0);
  const acuteAvg = weeklyLoad / 7;
  const chronicAvg = dailyLoad.reduce((a, b) => a + b, 0) / days;
  const mean7 = acuteAvg;
  const variance = last7.reduce((a, b) => a + Math.pow(b - mean7, 2), 0) / 7;
  const sd7 = Math.sqrt(variance);
  const monotony = sd7 > 0 ? mean7 / sd7 : 0;
  const strain = weeklyLoad * monotony;
  const acwr = chronicAvg > 0 ? acuteAvg / chronicAvg : 0;
  const hasAnyData = dailyLoad.some((v) => v > 0);

  const last7Dates = dates.slice(-7);
  const last7Entries = entries.filter((e) => last7Dates.includes(e.date));
  const last7Wellness = wellnessEntries.filter((w) => last7Dates.includes(w.date));
  const avg = (key) => {
    const vals = last7Wellness.map((w) => w[key]).filter((v) => v !== undefined && v !== null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const typeBreakdown = {};
  LOAD_TYPES.forEach((t) => { typeBreakdown[t.key] = 0; });
  last7Entries.forEach((e) => { typeBreakdown[e.type] = (typeBreakdown[e.type] || 0) + e.load; });

  return {
    dates, dailyLoad, weeklyLoad, acuteAvg, chronicAvg, monotony, strain, acwr, hasAnyData, typeBreakdown,
    wellness: { sleepHours: avg("sleepHours"), sleep: avg("sleep"), soreness: avg("soreness"), mood: avg("mood"), stress: avg("stress") },
  };
}

function acwrZone(acwr, hasData) {
  if (!hasData) return { label: "No data", color: C.textMuted, bg: C.surface2 };
  if (acwr < 0.8) return { label: "Undertrained", color: C.blue, bg: C.blueDark };
  if (acwr <= 1.3) return { label: "Optimal range", color: C.green, bg: C.greenDark };
  if (acwr <= 1.5) return { label: "Elevated risk", color: C.amber, bg: C.amberDark };
  return { label: "High risk", color: C.red, bg: C.redDark };
}

// composite readiness score (0-100) from a single day's check-in: sleep quality + mood
// count up, soreness + stress count down. null if no check-in that day.
function batteryScore(entry) {
  if (!entry) return null;
  const vals = [entry.sleep, entry.mood, 6 - entry.soreness, 6 - entry.stress].filter((v) => v !== undefined && v !== null);
  if (!vals.length) return null;
  const avg1to5 = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(((avg1to5 - 1) / 4) * 100);
}
function batteryZone(score) {
  if (score === null) return { label: "No check-in", color: C.textMuted, bg: C.surface2, fillColor: C.border };
  if (score >= 70) return { label: "Fresh", color: C.green, bg: C.greenDark, fillColor: C.green };
  if (score >= 40) return { label: "Moderate", color: C.amber, bg: C.amberDark, fillColor: C.amber };
  return { label: "Drained", color: C.red, bg: C.redDark, fillColor: C.red };
}
// 1-5 scale, higher = more of the thing (more sore, more stressed)
function levelZone(value) {
  if (value === undefined || value === null) return { label: "–", color: C.textMuted, bg: C.surface2 };
  if (value <= 2) return { label: "Low", color: C.green, bg: C.greenDark };
  if (value === 3) return { label: "Moderate", color: C.amber, bg: C.amberDark };
  return { label: "High", color: C.red, bg: C.redDark };
}

// ---------- small UI atoms ----------
function Badge({ children, color, bg }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium" style={{ color, backgroundColor: bg, fontFamily: fontBody }}>
      {children}
    </span>
  );
}

function AcwrTrack({ acwr, hasData }) {
  const clamped = Math.max(0, Math.min(acwr, 2));
  const pct = (clamped / 2) * 100;
  const zone = acwrZone(acwr, hasData);
  return (
    <div>
      <div style={{ position: "relative", height: 10, borderRadius: 6, overflow: "hidden", display: "flex" }}>
        <div style={{ width: "40%", background: C.blueDark }} />
        <div style={{ width: "25%", background: C.greenDark }} />
        <div style={{ width: "10%", background: C.amberDark }} />
        <div style={{ width: "25%", background: C.redDark }} />
        {hasData && (
          <div style={{ position: "absolute", left: `calc(${pct}% - 5px)`, top: -2, width: 10, height: 14, borderRadius: 5, background: zone.color, border: `2px solid ${C.bg}` }} />
        )}
      </div>
      <div className="flex justify-between mt-1" style={{ fontSize: 10, color: C.textMuted, fontFamily: fontMono }}>
        <span>0.0</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0</span>
      </div>
    </div>
  );
}

function ScaleButtons({ value, onChange, max = 5 }) {
  const items = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="flex gap-2">
      {items.map((n) => (
        <button key={n} onClick={() => onChange(n)} className="flex-1 rounded-lg py-2 text-sm font-medium transition"
          style={{ fontFamily: fontMono, background: value === n ? C.accent : C.surface2, color: value === n ? C.onRed : C.text, border: `1px solid ${value === n ? C.accent : C.border}` }}>
          {n}
        </button>
      ))}
    </div>
  );
}

function Sparkline({ data }) {
  const chartData = data.map((v, i) => ({ i, load: v }));
  return (
    <div style={{ height: 56 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.accent} stopOpacity={0.5} />
              <stop offset="100%" stopColor={C.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="load" stroke={C.accent} strokeWidth={2} fill="url(#sparkFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TypeMixBar({ breakdown }) {
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
        {LOAD_TYPES.map((t) => {
          const v = breakdown[t.key] || 0;
          if (!v) return null;
          return <div key={t.key} style={{ width: `${(v / total) * 100}%`, background: t.color }} />;
        })}
      </div>
    </div>
  );
}

function BatteryBar({ score }) {
  const zone = batteryZone(score);
  const pct = score === null ? 0 : Math.max(4, score);
  return (
    <div className="flex items-center gap-2">
      <div style={{ position: "relative", width: 46, height: 20, border: `1.5px solid ${C.borderStrong}`, borderRadius: 4, padding: 2, flexShrink: 0 }}>
        <div style={{ position: "absolute", right: -4, top: 6, width: 3, height: 8, borderRadius: 1, background: C.borderStrong }} />
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: zone.fillColor, transition: "width 0.2s" }} />
      </div>
      <div>
        <div style={{ fontFamily: fontMono, fontSize: 13, fontWeight: 600, color: zone.color }}>{score === null ? "–" : `${score}%`}</div>
      </div>
    </div>
  );
}

function DailyBatteryRow({ name, entry }) {
  const score = batteryScore(entry);
  const zone = batteryZone(score);
  const soreness = levelZone(entry?.soreness);
  const stress = levelZone(entry?.stress);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg flex-wrap" style={{ background: C.surface2 }}>
      <div style={{ fontFamily: fontBody, fontSize: 13, color: C.text, fontWeight: 500, flex: "1 1 30%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      <BatteryBar score={score} />
      <Badge color={soreness.color} bg={soreness.bg}>Soreness {soreness.label}</Badge>
      <Badge color={stress.color} bg={stress.bg}>Stress {stress.label}</Badge>
    </div>
  );
}

function DailyBatteryOverview({ roster, wellnessByPlayer }) {
  const today = todayISO();
  const rows = roster.map((p) => {
    const list = wellnessByPlayer[p.name] || [];
    const entry = list.find((w) => w.date === today) || null;
    return { name: p.name, entry, score: batteryScore(entry) };
  }).sort((a, b) => {
    const sa = a.score === null ? 999 : a.score;
    const sb = b.score === null ? 999 : b.score;
    return sa - sb;
  });

  if (!roster.length) return null;

  return (
    <div className="rounded-xl p-3 mb-5" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted }}>Daily battery · today's check-ins</div>
        <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>{rows.filter((r) => r.entry).length}/{rows.length} checked in</div>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => <DailyBatteryRow key={r.name} name={r.name} entry={r.entry} />)}
      </div>
    </div>
  );
}

function TypeSelector({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {LOAD_TYPES.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className="rounded-lg px-3 py-2 text-sm font-medium"
          style={{ fontFamily: fontBody, background: value === t.key ? t.color : C.surface1, color: value === t.key ? C.onRed : C.text, border: `1px solid ${value === t.key ? t.color : C.border}` }}>
          {t.short}
        </button>
      ))}
    </div>
  );
}

function PinPad({ title, subtitle, confirmLabel = "Continue", onSubmit, needsConfirm = false, error, onBack }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = () => {
    if (pin.length < 4) { setLocalError("PIN must be at least 4 digits."); return; }
    if (needsConfirm && pin !== pin2) { setLocalError("PINs do not match."); return; }
    setLocalError("");
    onSubmit(pin);
  };

  return (
    <div className="flex flex-col items-center" style={{ padding: "2rem 1rem" }}>
      <div className="rounded-full flex items-center justify-center mb-4" style={{ width: 44, height: 44, background: C.surface2 }}>
        <KeyRound size={20} color={C.brand} />
      </div>
      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 18, color: C.text, marginBottom: 4, textAlign: "center" }}>{title}</h2>
      {subtitle && <p style={{ fontFamily: fontBody, fontSize: 13, color: C.textMuted, marginBottom: 20, textAlign: "center" }}>{subtitle}</p>}
      <div className="flex flex-col gap-2 w-full" style={{ maxWidth: 240 }}>
        <input
          type="password" inputMode="numeric" autoFocus value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="PIN"
          onKeyDown={(e) => e.key === "Enter" && !needsConfirm && submit()}
          className="rounded-lg px-3 py-2 text-center"
          style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontMono, letterSpacing: 4, fontSize: 18 }}
        />
        {needsConfirm && (
          <input
            type="password" inputMode="numeric" value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
            placeholder="Confirm PIN"
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="rounded-lg px-3 py-2 text-center"
            style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontMono, letterSpacing: 4, fontSize: 18 }}
          />
        )}
      </div>
      {(localError || error) && (
        <div style={{ color: C.red, fontFamily: fontBody, fontSize: 12, marginTop: 10 }}>{localError || error}</div>
      )}
      <button onClick={submit} className="rounded-xl py-2.5 mt-5 font-semibold w-full" style={{ maxWidth: 240, background: C.accent, color: C.onRed, fontFamily: fontDisplay }}>
        {confirmLabel}
      </button>
      {onBack && (
        <button onClick={onBack} className="mt-3" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 12 }}>Back</button>
      )}
    </div>
  );
}

// ---------- landing ----------
function Landing({ onSelect }) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: 420, padding: "2rem 1rem" }}>
      <div style={{ fontFamily: fontMono, fontSize: 12, letterSpacing: 3, color: C.accent, marginBottom: 8, fontWeight: 600 }}>AS MONACO</div>
      <h1 style={{ fontFamily: fontDisplay, fontSize: 30, fontWeight: 700, color: C.text, margin: 0, textAlign: "center" }}>Load Monitor</h1>
      <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 14, marginTop: 6, marginBottom: 32, textAlign: "center" }}>
        Log session RPE and keep an eye on it from anywhere.
      </p>
      <div className="flex flex-col gap-3 w-full" style={{ maxWidth: 320 }}>
        <button onClick={() => onSelect("player")} className="flex items-center justify-between rounded-xl px-5 py-4" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
          <div className="text-left">
            <div style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 16 }}>I'm a player</div>
            <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>Log today's session</div>
          </div>
          <Activity size={20} color={C.brand} />
        </button>
        <button onClick={() => onSelect("coach")} className="flex items-center justify-between rounded-xl px-5 py-4" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
          <div className="text-left">
            <div style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 16 }}>I'm the coach</div>
            <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>Open team dashboard</div>
          </div>
          <BarChart3 size={20} color={C.accent} />
        </button>
      </div>
      <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 11, marginTop: 28, textAlign: "center", maxWidth: 320 }}>
        Player and coach access are both protected by a PIN. Entries are shared across the team.
      </p>
    </div>
  );
}

// ---------- player view ----------
function WellnessForm({ name, onSaved }) {
  const [date, setDate] = useState(todayISO());
  const [sleepHours, setSleepHours] = useState("");
  const [sleep, setSleep] = useState(3);
  const [soreness, setSoreness] = useState(3);
  const [mood, setMood] = useState(3);
  const [stress, setStress] = useState(3);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const list = await getJSON(`wellness:${name}`, []);
      const existing = list.find((w) => w.date === date);
      setSleepHours(existing?.sleepHours !== undefined && existing?.sleepHours !== null ? String(existing.sleepHours) : "");
      setSleep(existing?.sleep ?? 3);
      setSoreness(existing?.soreness ?? 3);
      setMood(existing?.mood ?? 3);
      setStress(existing?.stress ?? 3);
      setSaved(false);
    })();
  }, [date, name]);

  const submit = async () => {
    setError("");
    const hours = parseFloat(sleepHours.replace(",", "."));
    if (sleepHours !== "" && (isNaN(hours) || hours < 0 || hours > 24)) {
      setError("Enter a realistic number of hours (0–24).");
      return;
    }
    setSaving(true);
    const list = await getJSON(`wellness:${name}`, []);
    const filtered = list.filter((w) => w.date !== date);
    const entry = { date, sleepHours: sleepHours === "" ? null : hours, sleep, soreness, mood, stress };
    const updated = [...filtered, entry].sort((a, b) => a.date.localeCompare(b.date));
    await setJSON(`wellness:${name}`, updated);
    setSaving(false);
    setSaved(true);
    onSaved && onSaved();
  };

  return (
    <div>
      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 20, marginBottom: 4 }}>Morning check-in</h2>
      <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 13, marginBottom: 20 }}>How are you feeling today, before training?</p>

      <div className="mb-5">
        <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>Date</label>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)}
          className="rounded-lg px-3 py-2" style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }} />
      </div>

      <div className="mb-5">
        <div className="flex items-center gap-1 mb-2" style={{ color: C.textMuted, fontSize: 12, fontFamily: fontBody }}><Moon size={13} /> Hours slept last night</div>
        <div className="flex gap-2 mb-2 flex-wrap">
          {[5, 6, 7, 8, 9, 10].map((h) => (
            <button key={h} onClick={() => setSleepHours(String(h))} className="rounded-lg px-3 py-2 text-sm font-medium"
              style={{ fontFamily: fontMono, background: sleepHours === String(h) ? C.accent : C.surface1, color: sleepHours === String(h) ? C.onRed : C.text, border: `1px solid ${sleepHours === String(h) ? C.accent : C.border}` }}>
              {h}h
            </button>
          ))}
        </div>
        <input
          type="number" inputMode="decimal" step="0.5" min="0" max="24"
          value={sleepHours} onChange={(e) => setSleepHours(e.target.value)}
          placeholder="Or enter exact hours, e.g. 7.5"
          className="rounded-lg px-3 py-2 w-full"
          style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontMono }}
        />
      </div>

      <div className="flex flex-col gap-5 mb-5">
        <div>
          <div className="mb-2" style={{ color: C.textMuted, fontSize: 12, fontFamily: fontBody }}>Sleep quality (1 poor – 5 great)</div>
          <ScaleButtons value={sleep} onChange={setSleep} />
        </div>
        <div>
          <div className="mb-2" style={{ color: C.textMuted, fontSize: 12, fontFamily: fontBody }}>Muscle soreness (1 none – 5 severe)</div>
          <ScaleButtons value={soreness} onChange={setSoreness} />
        </div>
        <div>
          <div className="mb-2" style={{ color: C.textMuted, fontSize: 12, fontFamily: fontBody }}>Mood (1 low – 5 great)</div>
          <ScaleButtons value={mood} onChange={setMood} />
        </div>
        <div>
          <div className="flex items-center gap-1 mb-2" style={{ color: C.textMuted, fontSize: 12, fontFamily: fontBody }}><Zap size={13} /> Stress level (1 low – 5 high)</div>
          <ScaleButtons value={stress} onChange={setStress} />
        </div>
      </div>

      {error && <div style={{ color: C.red, fontFamily: fontBody, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <button onClick={submit} disabled={saving} className="w-full rounded-xl py-3 font-semibold"
        style={{ background: C.accent, color: C.onRed, fontFamily: fontDisplay, fontSize: 15 }}>
        {saving ? "Saving…" : "Save check-in"}
      </button>

      {saved && (
        <div className="flex items-center gap-2 mt-4">
          <Check size={16} color={C.green} />
          <span style={{ fontFamily: fontBody, color: C.text, fontSize: 13 }}>Check-in saved for {fmtDateShort(date)}.</span>
        </div>
      )}
    </div>
  );
}

function SessionForm({ name, onSaved }) {
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState(null);
  const [rpe, setRpe] = useState(null);
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState("");
  const [todaySessions, setTodaySessions] = useState([]);

  const refreshToday = useCallback(async (d) => {
    const entries = await getJSON(`entries:${name}`, []);
    setTodaySessions(entries.filter((e) => e.date === d));
  }, [name]);

  useEffect(() => {
    setType(null); setRpe(null); setDuration(""); setSaved(null);
    refreshToday(date);
  }, [date, refreshToday]);

  const handleSubmit = async () => {
    setError("");
    if (!type) { setError("Please select a load type."); return; }
    if (rpe === null) { setError("Please select an RPE."); return; }
    const dur = parseFloat(duration);
    if (!dur || dur <= 0) { setError("Please enter a duration in minutes."); return; }

    setSaving(true);
    const entries = await getJSON(`entries:${name}`, []);
    const load = Math.round(rpe * dur);
    // replace an existing entry of the same type on the same day, keep other types (two-a-days)
    const filtered = entries.filter((e) => !(e.date === date && e.type === type));
    const entry = { date, type, rpe, duration: dur, load };
    const updated = [...filtered, entry].sort((a, b) => a.date.localeCompare(b.date));
    await setJSON(`entries:${name}`, updated);
    setSaving(false);
    setSaved(entry);
    setType(null); setRpe(null); setDuration("");
    refreshToday(date);
    onSaved && onSaved();
  };

  return (
    <div>
      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 20, marginBottom: 4 }}>Log a session</h2>
      <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 13, marginBottom: 20 }}>How hard, how long, and what kind of session? Log each session separately on two-a-day days.</p>

      <div className="mb-5">
        <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>Date</label>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)}
          className="rounded-lg px-3 py-2" style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }} />
      </div>

      {todaySessions.length > 0 && (
        <div className="rounded-xl p-3 mb-5" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted, marginBottom: 6 }}>Already logged for {fmtDateShort(date)}</div>
          <div className="flex flex-col gap-1">
            {todaySessions.map((e) => (
              <div key={e.type} className="flex justify-between items-center" style={{ fontFamily: fontMono, fontSize: 12, color: C.text }}>
                <span className="flex items-center gap-2">
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: typeColor(e.type) }} />
                  <span style={{ fontFamily: fontBody, color: C.textMuted }}>{e.type}</span>
                </span>
                <span>{e.load} AU</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-5">
        <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 8 }}>Load type</label>
        <TypeSelector value={type} onChange={setType} />
      </div>

      <div className="mb-5">
        <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 8 }}>Session RPE (0–10)</label>
        <div className="grid grid-cols-6 gap-2 mb-2">
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <button key={n} onClick={() => setRpe(n)} className="rounded-lg py-2 text-sm font-semibold"
              style={{ fontFamily: fontMono, background: rpe === n ? C.brand : C.surface1, color: rpe === n ? C.onRed : C.text, border: `1px solid ${rpe === n ? C.brand : C.border}` }}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, minHeight: 16 }}>{rpe !== null ? RPE_LABELS[rpe] : "Tap a number"}</div>
      </div>

      <div className="mb-5">
        <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>Duration (minutes)</label>
        <input type="number" inputMode="numeric" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 90"
          className="rounded-lg px-3 py-2 w-full" style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontMono }} />
      </div>

      {error && <div style={{ color: C.red, fontFamily: fontBody, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <button onClick={handleSubmit} disabled={saving} className="w-full rounded-xl py-3 font-semibold"
        style={{ background: C.accent, color: C.onRed, fontFamily: fontDisplay, fontSize: 15 }}>
        {saving ? "Saving…" : "Save session"}
      </button>

      {saved && (
        <div className="flex items-center gap-2 mt-4">
          <Check size={16} color={C.green} />
          <span style={{ fontFamily: fontBody, color: C.text, fontSize: 13 }}>
            Saved {saved.type} for {fmtDateShort(saved.date)} · <span style={{ fontFamily: fontMono, color: C.brand }}>{saved.load} AU</span>
          </span>
        </div>
      )}
    </div>
  );
}

function PlayerView({ onBack }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [mode, setMode] = useState("hub"); // hub | wellness | session
  const [checkedInToday, setCheckedInToday] = useState(false);

  useEffect(() => {
    (async () => {
      const r = normalizeRoster(await getJSON("roster", []));
      setRoster(r);
      setLoading(false);
    })();
  }, []);

  const refreshCheckin = useCallback(async () => {
    const list = await getJSON(`wellness:${name}`, []);
    setCheckedInToday(list.some((w) => w.date === todayISO()));
  }, [name]);

  useEffect(() => { if (authed) refreshCheckin(); }, [authed, refreshCheckin]);

  const registerNewPlayer = async (pin) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (roster.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      setAuthError("That name is already registered. Select it from the list instead.");
      return;
    }
    const updated = [...roster, { name: trimmed, pinHash: hashPin(pin) }].sort((a, b) => a.name.localeCompare(b.name));
    setRoster(updated);
    await setJSON("roster", updated);
    setName(trimmed);
    setAddingNew(false);
    setAuthed(true);
    setAuthError("");
  };

  const tryLogin = (pin) => {
    const player = roster.find((p) => p.name === name);
    if (!player) return;
    if (player.pinHash === hashPin(pin)) { setAuthed(true); setAuthError(""); }
    else setAuthError("Incorrect PIN. Try again.");
  };

  const switchPlayer = () => {
    setAuthed(false); setName(""); setAuthError(""); setAddingNew(false); setNewName(""); setMode("hub");
  };

  if (loading) return <div style={{ padding: "2rem 1rem", color: C.textMuted, fontFamily: fontBody }}>Loading…</div>;

  // ---- auth gate ----
  if (!authed) {
    return (
      <div style={{ padding: "1.25rem 1rem 2rem" }}>
        <button onClick={onBack} className="flex items-center gap-1 mb-4" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 13 }}>
          <ArrowLeft size={15} /> Back
        </button>

        {!addingNew ? (
          <>
            <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>Select your name</label>
            <select
              value={name}
              onChange={(e) => { setAuthError(""); e.target.value === "__new__" ? setAddingNew(true) : setName(e.target.value); }}
              className="w-full rounded-lg px-3 py-2 mb-4"
              style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }}
            >
              <option value="">Select…</option>
              {roster.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              <option value="__new__">+ New player</option>
            </select>
            {name && (
              <PinPad title={`Hi ${name}`} subtitle="Enter your PIN to continue." confirmLabel="Unlock" onSubmit={tryLogin} error={authError} />
            )}
          </>
        ) : (
          <>
            <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>Your name</label>
            <input
              autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="First and last name"
              className="w-full rounded-lg px-3 py-2 mb-2"
              style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }}
            />
            {newName.trim() && (
              <PinPad
                title="Set a PIN" subtitle="Pick a 4+ digit PIN to protect your entries." needsConfirm
                confirmLabel="Create account" onSubmit={registerNewPlayer} error={authError}
                onBack={() => { setAddingNew(false); setNewName(""); }}
              />
            )}
          </>
        )}
      </div>
    );
  }

  // ---- hub ----
  return (
    <div style={{ padding: "1.25rem 1rem 2rem" }}>
      <div className="flex items-center justify-between mb-4">
        <button onClick={mode === "hub" ? onBack : () => setMode("hub")} className="flex items-center gap-1" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 13 }}>
          <ArrowLeft size={15} /> Back
        </button>
        <button onClick={switchPlayer} className="flex items-center gap-1" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 13 }}>
          <LogOut size={13} /> {name}
        </button>
      </div>

      {mode === "hub" && (
        <>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 20, marginBottom: 4 }}>Hi {name}</h2>
          <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 13, marginBottom: 20 }}>What would you like to log?</p>

          <div className="flex flex-col gap-3">
            <button onClick={() => setMode("wellness")} className="flex items-center justify-between rounded-xl px-5 py-4" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
              <div className="text-left">
                <div style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 15 }}>Morning check-in</div>
                <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>
                  {checkedInToday ? "Done for today — tap to edit" : "Not done yet today"}
                </div>
              </div>
              {checkedInToday ? <Check size={20} color={C.green} /> : <Moon size={20} color={C.brand} />}
            </button>
            <button onClick={() => setMode("session")} className="flex items-center justify-between rounded-xl px-5 py-4" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
              <div className="text-left">
                <div style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 15 }}>Log a session</div>
                <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>RPE, duration, load type</div>
              </div>
              <Activity size={20} color={C.accent} />
            </button>
          </div>
        </>
      )}

      {mode === "wellness" && <WellnessForm name={name} onSaved={refreshCheckin} />}
      {mode === "session" && <SessionForm name={name} />}
    </div>
  );
}

// ---------- coach view ----------
function PlayerCard({ name, entries, wellness, onRemove }) {
  const m = useMemo(() => computeMetrics(entries, wellness), [entries, wellness]);
  const zone = acwrZone(m.acwr, m.hasAnyData);
  const flagged = m.hasAnyData && (m.acwr > 1.5 || m.monotony > 2);

  return (
    <div className="rounded-xl p-4" style={{ background: C.surface1, border: `1px solid ${flagged ? C.red : C.border}` }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 15, color: C.text }}>{name}</div>
          <Badge color={zone.color} bg={zone.bg}>{flagged && <AlertTriangle size={11} />} {zone.label}</Badge>
        </div>
        <button onClick={() => onRemove(name)} title="Remove from roster"><Trash2 size={14} color={C.textMuted} /></button>
      </div>

      <Sparkline data={m.dailyLoad} />

      <div className="grid grid-cols-3 gap-2 my-3">
        <div>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>Weekly load</div>
          <div style={{ fontFamily: fontMono, fontSize: 15, color: C.text, fontWeight: 600 }}>{Math.round(m.weeklyLoad)}</div>
        </div>
        <div>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>ACWR</div>
          <div style={{ fontFamily: fontMono, fontSize: 15, color: C.text, fontWeight: 600 }}>{m.hasAnyData ? m.acwr.toFixed(2) : "–"}</div>
        </div>
        <div>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>Monotony</div>
          <div style={{ fontFamily: fontMono, fontSize: 15, color: m.monotony > 2 ? C.amber : C.text, fontWeight: 600 }}>{m.hasAnyData ? m.monotony.toFixed(1) : "–"}</div>
        </div>
      </div>

      <AcwrTrack acwr={m.acwr} hasData={m.hasAnyData} />

      {m.hasAnyData && (
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted, marginBottom: 6 }}>7-day load mix</div>
          <TypeMixBar breakdown={m.typeBreakdown} />
        </div>
      )}

      {(m.wellness.sleepHours || m.wellness.sleep || m.wellness.soreness || m.wellness.mood || m.wellness.stress) && (
        <div className="flex gap-3 mt-3 pt-3 flex-wrap" style={{ borderTop: `1px solid ${C.border}` }}>
          {m.wellness.sleepHours !== null && <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>Sleep <span style={{ fontFamily: fontMono, color: C.text }}>{m.wellness.sleepHours.toFixed(1)}h</span></div>}
          {m.wellness.sleep !== null && <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>Sleep quality <span style={{ fontFamily: fontMono, color: C.text }}>{m.wellness.sleep.toFixed(1)}</span></div>}
          {m.wellness.soreness !== null && <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>Soreness <span style={{ fontFamily: fontMono, color: C.text }}>{m.wellness.soreness.toFixed(1)}</span></div>}
          {m.wellness.mood !== null && <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>Mood <span style={{ fontFamily: fontMono, color: C.text }}>{m.wellness.mood.toFixed(1)}</span></div>}
          {m.wellness.stress !== null && <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>Stress <span style={{ fontFamily: fontMono, color: C.text }}>{m.wellness.stress.toFixed(1)}</span></div>}
        </div>
      )}
    </div>
  );
}

function CoachRoleChooser({ onChoose }) {
  return (
    <div>
      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 18, marginBottom: 4 }}>Coach access</h2>
      <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 13, marginBottom: 20 }}>Are you the admin or a coach?</p>
      <div className="flex flex-col gap-3">
        <button onClick={() => onChoose("admin")} className="flex items-center justify-between rounded-xl px-5 py-4" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
          <div className="text-left">
            <div style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 15 }}>Admin</div>
            <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>Full access, manages coach accounts</div>
          </div>
          <KeyRound size={18} color={C.accent} />
        </button>
        <button onClick={() => onChoose("coach")} className="flex items-center justify-between rounded-xl px-5 py-4" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
          <div className="text-left">
            <div style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 15 }}>Coach</div>
            <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>Dashboard access with your own PIN</div>
          </div>
          <Users size={18} color={C.accent} />
        </button>
      </div>
    </div>
  );
}

function CoachView({ onBack }) {
  const [pinLoading, setPinLoading] = useState(true);
  const [adminPinHash, setAdminPinHash] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [role, setRole] = useState(null); // null | "admin" | "coach"
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [coachName, setCoachName] = useState("");
  const [addingNewCoach, setAddingNewCoach] = useState(false);
  const [newCoachName, setNewCoachName] = useState("");

  const [roster, setRoster] = useState([]);
  const [entriesByPlayer, setEntriesByPlayer] = useState({});
  const [wellnessByPlayer, setWellnessByPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const [newPlayer, setNewPlayer] = useState("");
  const [rosterOpen, setRosterOpen] = useState(false);
  const [coachesOpen, setCoachesOpen] = useState(false);
  const [newCoachAdmin, setNewCoachAdmin] = useState("");

  useEffect(() => {
    (async () => {
      const h = await getJSON("admin_pin", null);
      const c = await getJSON("coaches", []);
      setAdminPinHash(h);
      setCoaches(c);
      setPinLoading(false);
    })();
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const r = normalizeRoster(await getJSON("roster", []));
    setRoster(r);
    const eMap = {}, wMap = {};
    for (const p of r) {
      eMap[p.name] = await getJSON(`entries:${p.name}`, []);
      wMap[p.name] = await getJSON(`wellness:${p.name}`, []);
    }
    setEntriesByPlayer(eMap);
    setWellnessByPlayer(wMap);
    setLoading(false);
  }, []);

  useEffect(() => { if (authed) loadAll(); }, [authed, loadAll]);

  const setupAdminPin = async (pin) => {
    const h = hashPin(pin);
    await setJSON("admin_pin", h);
    setAdminPinHash(h);
    setAuthed(true);
  };
  const tryAdminLogin = (pin) => {
    if (hashPin(pin) === adminPinHash) { setAuthed(true); setAuthError(""); }
    else setAuthError("Incorrect PIN. Try again.");
  };

  const registerNewCoach = async (pin) => {
    const trimmed = newCoachName.trim();
    if (!trimmed) return;
    if (coaches.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setAuthError("That name is already registered. Select it from the list instead.");
      return;
    }
    const updated = [...coaches, { name: trimmed, pinHash: hashPin(pin) }].sort((a, b) => a.name.localeCompare(b.name));
    setCoaches(updated);
    await setJSON("coaches", updated);
    setCoachName(trimmed);
    setAddingNewCoach(false);
    setAuthed(true);
    setAuthError("");
  };
  const tryCoachLogin = (pin) => {
    const c = coaches.find((x) => x.name === coachName);
    if (!c) return;
    if (c.pinHash === hashPin(pin)) { setAuthed(true); setAuthError(""); }
    else setAuthError("Incorrect PIN. Try again.");
  };

  const lock = () => {
    setAuthed(false); setRole(null); setAuthError("");
    setCoachName(""); setAddingNewCoach(false); setNewCoachName("");
  };

  const addPlayer = async () => {
    const trimmed = newPlayer.trim();
    if (!trimmed || roster.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return;
    // coach-added players get a temporary PIN of "0000" until the player sets her own on first login
    const updated = [...roster, { name: trimmed, pinHash: hashPin("0000") }].sort((a, b) => a.name.localeCompare(b.name));
    setRoster(updated);
    await setJSON("roster", updated);
    setEntriesByPlayer((prev) => ({ ...prev, [trimmed]: [] }));
    setNewPlayer("");
  };

  const removePlayer = async (name) => {
    const updated = roster.filter((p) => p.name !== name);
    setRoster(updated);
    await setJSON("roster", updated);
  };

  const addCoachAdmin = async () => {
    const trimmed = newCoachAdmin.trim();
    if (!trimmed || coaches.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return;
    // admin-added coaches get a temporary PIN of "0000" until they set their own on first login
    const updated = [...coaches, { name: trimmed, pinHash: hashPin("0000") }].sort((a, b) => a.name.localeCompare(b.name));
    setCoaches(updated);
    await setJSON("coaches", updated);
    setNewCoachAdmin("");
  };

  const removeCoach = async (name) => {
    const updated = coaches.filter((c) => c.name !== name);
    setCoaches(updated);
    await setJSON("coaches", updated);
  };

  const downloadCSV = (filename, rows) => {
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportSessionsCSV = () => {
    const rows = [["Name", "Date", "Type", "RPE", "Duration_min", "Load_AU"]];
    for (const p of roster) {
      for (const e of entriesByPlayer[p.name] || []) {
        rows.push([p.name, e.date, e.type, e.rpe, e.duration, e.load]);
      }
    }
    downloadCSV(`load-monitor-sessions-${todayISO()}.csv`, rows);
  };

  const exportWellnessCSV = () => {
    const rows = [["Name", "Date", "Sleep_hours", "Sleep_quality", "Soreness", "Mood", "Stress"]];
    for (const p of roster) {
      for (const w of wellnessByPlayer[p.name] || []) {
        rows.push([p.name, w.date, w.sleepHours ?? "", w.sleep, w.soreness, w.mood, w.stress]);
      }
    }
    downloadCSV(`load-monitor-wellness-${todayISO()}.csv`, rows);
  };

  const teamStats = useMemo(() => {
    const today = todayISO();
    let loggedToday = 0, totalToday = 0, atRisk = 0;
    const dailyByType = Array.from({ length: 28 }, () => {
      const o = {}; LOAD_TYPES.forEach((t) => { o[t.key] = 0; }); return o;
    });
    for (const p of roster) {
      const entries = entriesByPlayer[p.name] || [];
      const todaySessions = entries.filter((e) => e.date === today);
      if (todaySessions.length) { loggedToday += 1; totalToday += todaySessions.reduce((a, e) => a + e.load, 0); }
      const m = computeMetrics(entries, wellnessByPlayer[p.name] || []);
      if (m.hasAnyData && (m.acwr > 1.5 || m.monotony > 2)) atRisk += 1;
      m.dates.forEach((d, i) => {
        entries.filter((e) => e.date === d).forEach((e) => {
          dailyByType[i][e.type] = (dailyByType[i][e.type] || 0) + e.load;
        });
      });
    }
    return { loggedToday, totalToday, atRisk, dailyByType };
  }, [roster, entriesByPlayer, wellnessByPlayer]);

  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => {
      const ma = computeMetrics(entriesByPlayer[a.name] || [], wellnessByPlayer[a.name] || []);
      const mb = computeMetrics(entriesByPlayer[b.name] || [], wellnessByPlayer[b.name] || []);
      const riskA = ma.hasAnyData && (ma.acwr > 1.5 || ma.monotony > 2) ? 1 : 0;
      const riskB = mb.hasAnyData && (mb.acwr > 1.5 || mb.monotony > 2) ? 1 : 0;
      if (riskA !== riskB) return riskB - riskA;
      return a.name.localeCompare(b.name);
    });
  }, [roster, entriesByPlayer, wellnessByPlayer]);

  const chartData = teamStats.dailyByType.map((dayTypes, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (27 - i));
    return { label: fmtDateShort(d.toISOString().slice(0, 10)), ...dayTypes };
  });

  if (pinLoading) return <div style={{ padding: "2rem 1rem", color: C.textMuted, fontFamily: fontBody }}>Loading…</div>;

  // ---- auth gate ----
  if (!authed) {
    return (
      <div style={{ padding: "1.25rem 1rem 2rem" }}>
        <button onClick={role === null ? onBack : () => { setRole(null); setAuthError(""); }} className="flex items-center gap-1 mb-4" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 13 }}>
          <ArrowLeft size={15} /> Back
        </button>

        {role === null && <CoachRoleChooser onChoose={setRole} />}

        {role === "admin" && (
          adminPinHash === null ? (
            <PinPad title="Set the admin PIN" subtitle="Only you should know this. It protects account management and can't be recovered from here." needsConfirm confirmLabel="Create PIN" onSubmit={setupAdminPin} />
          ) : (
            <PinPad title="Admin access" subtitle="Enter the admin PIN." confirmLabel="Unlock" onSubmit={tryAdminLogin} error={authError} />
          )
        )}

        {role === "coach" && !addingNewCoach && (
          <>
            <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>Select your name</label>
            <select
              value={coachName}
              onChange={(e) => { setAuthError(""); e.target.value === "__new__" ? setAddingNewCoach(true) : setCoachName(e.target.value); }}
              className="w-full rounded-lg px-3 py-2 mb-4"
              style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }}
            >
              <option value="">Select…</option>
              {coaches.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              <option value="__new__">+ New coach</option>
            </select>
            {coachName && (
              <PinPad title={`Hi ${coachName}`} subtitle="Enter your PIN to open the dashboard." confirmLabel="Unlock" onSubmit={tryCoachLogin} error={authError} />
            )}
          </>
        )}

        {role === "coach" && addingNewCoach && (
          <>
            <label style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, display: "block", marginBottom: 6 }}>Your name</label>
            <input
              autoFocus value={newCoachName} onChange={(e) => setNewCoachName(e.target.value)}
              placeholder="First and last name"
              className="w-full rounded-lg px-3 py-2 mb-2"
              style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }}
            />
            {newCoachName.trim() && (
              <PinPad
                title="Set a PIN" subtitle="Pick a 4+ digit PIN to protect your access." needsConfirm
                confirmLabel="Create account" onSubmit={registerNewCoach} error={authError}
                onBack={() => { setAddingNewCoach(false); setNewCoachName(""); }}
              />
            )}
          </>
        )}
      </div>
    );
  }

  // ---- dashboard ----
  return (
    <div style={{ padding: "1.25rem 1rem 2rem" }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <button onClick={onBack} className="flex items-center gap-1" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 13 }}><ArrowLeft size={15} /> Back</button>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge color={C.accent} bg={C.redDark}>{role === "admin" ? "Admin" : `Coach · ${coachName}`}</Badge>
          <button onClick={lock} className="flex items-center gap-1" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 12 }}><Lock size={13} /> Lock</button>
          <button onClick={exportSessionsCSV} className="flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ background: C.surface1, border: `1px solid ${C.border}`, color: C.text, fontFamily: fontBody, fontSize: 12 }}>
            <Download size={13} /> Sessions
          </button>
          <button onClick={exportWellnessCSV} className="flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ background: C.surface1, border: `1px solid ${C.border}`, color: C.text, fontFamily: fontBody, fontSize: 12 }}>
            <Download size={13} /> Wellness
          </button>
        </div>
      </div>

      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 20, marginBottom: 16 }}>Team dashboard</h2>

      {loading ? (
        <div style={{ color: C.textMuted, fontFamily: fontBody }}>Loading data…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-5">
            <div className="rounded-xl p-3" style={{ background: C.surface1 }}>
              <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>Logged today</div>
              <div style={{ fontFamily: fontMono, fontSize: 18, color: C.text, fontWeight: 600 }}>{teamStats.loggedToday}/{roster.length}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: C.surface1 }}>
              <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>Team load today</div>
              <div style={{ fontFamily: fontMono, fontSize: 18, color: C.brand, fontWeight: 600 }}>{Math.round(teamStats.totalToday)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: C.surface1 }}>
              <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>At risk</div>
              <div style={{ fontFamily: fontMono, fontSize: 18, color: teamStats.atRisk > 0 ? C.red : C.text, fontWeight: 600 }}>{teamStats.atRisk}</div>
            </div>
          </div>

          <DailyBatteryOverview roster={roster} wellnessByPlayer={wellnessByPlayer} />

          <div className="rounded-xl p-3 mb-5" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-2">
              <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted }}>Team load, last 28 days</div>
              <div className="flex gap-2 flex-wrap justify-end">
                {LOAD_TYPES.map((t) => (
                  <span key={t.key} className="flex items-center gap-1" style={{ fontSize: 10, color: C.textMuted, fontFamily: fontBody }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: t.color, display: "inline-block" }} />{t.short}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 9, fontFamily: fontMono }} interval={4} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis tick={{ fill: C.textMuted, fontSize: 9, fontFamily: fontMono }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: fontBody, fontSize: 12 }} labelStyle={{ color: C.textMuted }} itemStyle={{ color: C.text }} />
                  {LOAD_TYPES.map((t) => <Bar key={t.key} dataKey={t.key} stackId="a" fill={t.color} radius={[0, 0, 0, 0]} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {role === "admin" && (
            <div className="rounded-xl mb-5" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
              <button onClick={() => setCoachesOpen((o) => !o)} className="flex items-center justify-between w-full px-4 py-3">
                <span className="flex items-center gap-2" style={{ fontFamily: fontBody, fontSize: 13, color: C.text, fontWeight: 500 }}><KeyRound size={14} /> Manage coach accounts ({coaches.length})</span>
                {coachesOpen ? <ChevronUp size={16} color={C.textMuted} /> : <ChevronDown size={16} color={C.textMuted} />}
              </button>
              {coachesOpen && (
                <div className="px-4 pb-4">
                  <div className="flex gap-2 mb-2">
                    <input value={newCoachAdmin} onChange={(e) => setNewCoachAdmin(e.target.value)} placeholder="Coach name"
                      className="flex-1 rounded-lg px-3 py-2" style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }} />
                    <button onClick={addCoachAdmin} className="rounded-lg px-3" style={{ background: C.accent, color: C.onRed }}><Plus size={16} /></button>
                  </div>
                  <p style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
                    Coaches added here get temporary PIN <span style={{ fontFamily: fontMono }}>0000</span> — tell them to log in as "Coach" and it's usable right away.
                    They can also register themselves directly with their own PIN from the coach login screen.
                  </p>
                  <div className="flex flex-col gap-1">
                    {coaches.length === 0 && (
                      <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted }}>No coach accounts yet.</div>
                    )}
                    {coaches.map((c) => (
                      <div key={c.name} className="flex items-center justify-between px-2 py-1.5 rounded-lg" style={{ background: C.surface2 }}>
                        <span style={{ fontFamily: fontBody, fontSize: 13, color: C.text }}>{c.name}</span>
                        <button onClick={() => removeCoach(c.name)}><X size={14} color={C.textMuted} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl mb-5" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
            <button onClick={() => setRosterOpen((o) => !o)} className="flex items-center justify-between w-full px-4 py-3">
              <span className="flex items-center gap-2" style={{ fontFamily: fontBody, fontSize: 13, color: C.text, fontWeight: 500 }}><Users size={14} /> Manage roster ({roster.length})</span>
              {rosterOpen ? <ChevronUp size={16} color={C.textMuted} /> : <ChevronDown size={16} color={C.textMuted} />}
            </button>
            {rosterOpen && (
              <div className="px-4 pb-4">
                <div className="flex gap-2 mb-2">
                  <input value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} placeholder="Player name"
                    className="flex-1 rounded-lg px-3 py-2" style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody }} />
                  <button onClick={addPlayer} className="rounded-lg px-3" style={{ background: C.accent, color: C.onRed }}><Plus size={16} /></button>
                </div>
                <p style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
                  Players added here get temporary PIN <span style={{ fontFamily: fontMono }}>0000</span> — tell them to log in and it's usable right away.
                  They can also register themselves directly from the player screen with their own PIN.
                </p>
                <div className="flex flex-col gap-1">
                  {roster.map((p) => (
                    <div key={p.name} className="flex items-center justify-between px-2 py-1.5 rounded-lg" style={{ background: C.surface2 }}>
                      <span style={{ fontFamily: fontBody, fontSize: 13, color: C.text }}>{p.name}</span>
                      <button onClick={() => removePlayer(p.name)}><X size={14} color={C.textMuted} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {roster.length === 0 ? (
            <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 13, textAlign: "center", padding: "2rem 0" }}>
              No roster yet. Players can register themselves on first entry, or add them here manually.
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              {sortedRoster.map((p) => (
                <PlayerCard key={p.name} name={p.name} entries={entriesByPlayer[p.name] || []} wellness={wellnessByPlayer[p.name] || []} onRemove={removePlayer} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- root ----------
export default function LoadMonitorApp() {
  const [view, setView] = useState("landing");
  return (
    <div style={{ background: C.bg, minHeight: 500, maxWidth: 720, margin: "0 auto", borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <style>{FONTS}</style>
      <div style={{ height: 6, background: `repeating-linear-gradient(-45deg, ${C.accent} 0px, ${C.accent} 14px, #FFFFFF 14px, #FFFFFF 28px)` }} />
      {view === "landing" && <Landing onSelect={setView} />}
      {view === "player" && <PlayerView onBack={() => setView("landing")} />}
      {view === "coach" && <CoachView onBack={() => setView("landing")} />}
    </div>
  );
}
