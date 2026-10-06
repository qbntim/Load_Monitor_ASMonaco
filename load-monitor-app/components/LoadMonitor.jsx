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
// explicit "no training today" marker, stored like a session with zero load so it counts as a logged day
const REST_TYPE = "Rest day";
const isRest = (e) => e.type === REST_TYPE;

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

// local calendar date as YYYY-MM-DD (NOT toISOString, which is UTC and shifts the day around midnight in Europe)
function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayISO() {
  return toLocalISO(new Date());
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
    const iso = toLocalISO(d);
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

  // Baseline: the chronic (28-day) average is only meaningful once there are 28 days of history.
  // Before that it is diluted by days that simply weren't tracked yet, which inflates the ACWR.
  const parseLocal = (iso) => { const [y, mo, d] = iso.split("-").map(Number); return new Date(y, mo - 1, d); };
  const firstDate = entries.length ? entries.reduce((min, e) => (e.date < min ? e.date : min), entries[0].date) : null;
  const baselineDays = firstDate ? Math.min(days, Math.round((today - parseLocal(firstDate)) / 86400000) + 1) : 0;
  const acwrReady = baselineDays >= days;
  // Gaps: days since the player started without any entry (session or rest day), looking at the
  // 6 days before today (today may still be pending). Gaps count as zero load and understate the ACWR.
  const loggedDates = new Set(entries.map((e) => e.date));
  const gaps6 = firstDate ? dates.slice(-7, -1).filter((d) => d >= firstDate && !loggedDates.has(d)).length : 0;

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
  last7Entries.filter((e) => !isRest(e)).forEach((e) => { typeBreakdown[e.type] = (typeBreakdown[e.type] || 0) + e.load; });

  return {
    dates, dailyLoad, weeklyLoad, acuteAvg, chronicAvg, monotony, strain, acwr, hasAnyData, typeBreakdown,
    baselineDays, acwrReady, gaps6,
    wellness: { sleepHours: avg("sleepHours"), readiness: avg("readiness"), sleep: avg("sleep"), soreness: avg("soreness"), mood: avg("mood"), stress: avg("stress") },
  };
}

// a player is flagged when the ACWR is in the high-risk zone (only once the 28-day baseline exists)
// or the weekly load has been very monotonous
const isFlagged = (m) => m.hasAnyData && ((m.acwrReady && m.acwr > 1.5) || m.monotony > 2);

function acwrZone(acwr, hasData, ready = true, baselineDays = 28) {
  if (!hasData) return { label: "No data", color: C.textMuted, bg: C.surface2 };
  if (!ready) return { label: `Baseline ${baselineDays}/28 days`, color: C.textMuted, bg: C.surface2 };
  if (acwr < 0.8) return { label: "Undertrained", color: C.blue, bg: C.blueDark };
  if (acwr <= 1.3) return { label: "Optimal range", color: C.green, bg: C.greenDark };
  if (acwr <= 1.5) return { label: "Elevated risk", color: C.amber, bg: C.amberDark };
  return { label: "High risk", color: C.red, bg: C.redDark };
}

// composite battery score (0-100) from a single day's check-in: readiness, sleep quality and mood
// count up; soreness and stress count down (inverted). Items missing from older check-ins
// (e.g. readiness before it existed) are simply left out. null if no check-in that day.
const isNum = (v) => typeof v === "number" && !isNaN(v);
function batteryScore(entry) {
  if (!entry) return null;
  const vals = [
    entry.readiness,
    entry.sleep,
    entry.mood,
    isNum(entry.soreness) ? 6 - entry.soreness : null,
    isNum(entry.stress) ? 6 - entry.stress : null,
  ].filter(isNum);
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
// 1-5 scale, higher = better (sleep quality, mood)
function qualityZone(value) {
  if (value === undefined || value === null) return { label: "–", color: C.textMuted, bg: C.surface2 };
  if (value >= 4) return { label: "Good", color: C.green, bg: C.greenDark };
  if (value === 3) return { label: "Okay", color: C.amber, bg: C.amberDark };
  return { label: "Poor", color: C.red, bg: C.redDark };
}
// 1-5 readiness to train, higher = more ready
function readinessZone(value) {
  if (value === undefined || value === null) return { label: "–", color: C.textMuted, bg: C.surface2 };
  if (value >= 4) return { label: "High", color: C.green, bg: C.greenDark };
  if (value === 3) return { label: "Moderate", color: C.amber, bg: C.amberDark };
  return { label: "Low", color: C.red, bg: C.redDark };
}
// hours slept, higher = better (rough youth-athlete guideline: 8h+ good, 6-8h okay, <6h low)
function sleepHoursZone(hours) {
  if (hours === undefined || hours === null) return { label: "–", color: C.textMuted, bg: C.surface2 };
  if (hours >= 8) return { label: "Good", color: C.green, bg: C.greenDark };
  if (hours >= 6) return { label: "Okay", color: C.amber, bg: C.amberDark };
  return { label: "Low", color: C.red, bg: C.redDark };
}

// ---------- pain reporting ----------
// Structure follows common sports-medicine practice:
//  - Intensity: Numeric Rating Scale (NRS, 0-10)
//  - Quality: descriptors adapted from the McGill Pain Questionnaire short form (SF-MPQ) + tingling/numbness
//  - Location, timing and onset: region + side, volleyball-specific triggers, sudden vs gradual
// This is a monitoring aid, not a diagnostic instrument.
const PAIN_REGIONS = [
  { group: "Head & neck", items: [{ key: "Head", central: true }, { key: "Neck", central: true }] },
  { group: "Upper body", items: [{ key: "Shoulder" }, { key: "Upper arm" }, { key: "Elbow" }, { key: "Forearm" }, { key: "Wrist" }, { key: "Hand / fingers" }] },
  { group: "Trunk", items: [{ key: "Upper back", central: true }, { key: "Lower back", central: true }, { key: "Chest / ribs", central: true }, { key: "Abdomen / core", central: true }] },
  { group: "Lower body", items: [{ key: "Hip / groin" }, { key: "Thigh (front)" }, { key: "Thigh (back)" }, { key: "Knee" }, { key: "Lower leg / calf" }, { key: "Shin" }, { key: "Ankle" }, { key: "Foot / toes" }] },
];
const PAIN_CENTRAL = new Set(PAIN_REGIONS.flatMap((g) => g.items.filter((i) => i.central).map((i) => i.key)));
const PAIN_SIDES = [
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
  { key: "both", label: "Both" },
];
const PAIN_QUALITIES = ["Throbbing", "Shooting", "Stabbing", "Sharp", "Cramping", "Burning", "Aching / dull", "Heavy", "Tender to touch", "Tingling / numb"];
const PAIN_TIMING = [
  "At rest", "At night", "Morning stiffness", "During warm-up", "During training", "After training",
  "Jumping / landing", "Hitting / serving", "Diving / floor contact", "Lifting / S&C", "Running / direction changes",
];
const PAIN_ONSET = [
  { key: "sudden", label: "Suddenly (a specific moment)" },
  { key: "gradual", label: "Gradually (built up over time)" },
];
function painZone(intensity) {
  if (intensity === undefined || intensity === null) return { label: "–", color: C.textMuted, bg: C.surface2 };
  if (intensity <= 0) return { label: "None", color: C.textMuted, bg: C.surface2 };
  if (intensity <= 3) return { label: "Mild", color: C.green, bg: C.greenDark };
  if (intensity <= 6) return { label: "Moderate", color: C.amber, bg: C.amberDark };
  return { label: "Severe", color: C.red, bg: C.redDark };
}
const painKey = (r) => `${r.region}|${r.side}`;
// latest entry per region+side; active unless that latest entry is a "resolved" marker
function activePains(reports) {
  const latest = {};
  for (const r of reports || []) {
    const k = painKey(r);
    if (!latest[k] || r.ts > latest[k].ts) latest[k] = r;
  }
  return Object.values(latest).filter((r) => r.status !== "resolved").sort((a, b) => b.intensity - a.intensity);
}
function painLocation(r) {
  const side = r.side === "left" ? "left" : r.side === "right" ? "right" : r.side === "both" ? "both sides" : "";
  return side ? `${r.region} · ${side}` : r.region;
}
function fmtDateTime(ts) {
  try {
    return new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
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

function BaselineBar({ days }) {
  const pct = Math.max(0, Math.min(100, (days / 28) * 100));
  return (
    <div>
      <div style={{ height: 10, borderRadius: 6, overflow: "hidden", background: C.surface2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: C.textMuted }} />
      </div>
      <div className="mt-1" style={{ fontSize: 10, color: C.textMuted, fontFamily: fontMono }}>
        ACWR needs 28 days of data · {days}/28
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

function DailyBatteryRow({ name, entry, pains = [] }) {
  const score = batteryScore(entry);
  const readiness = readinessZone(entry?.readiness);
  const soreness = levelZone(entry?.soreness);
  const stress = levelZone(entry?.stress);
  const sleepQuality = qualityZone(entry?.sleep);
  const sleepHours = sleepHoursZone(entry?.sleepHours);
  const topPain = pains[0];
  const topPainZone = topPain ? painZone(topPain.intensity) : null;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg flex-wrap" style={{ background: C.surface2 }}>
      <div style={{ fontFamily: fontBody, fontSize: 13, color: C.text, fontWeight: 500, flex: "1 1 30%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      <BatteryBar score={score} />
      <div className="flex items-center gap-1.5 flex-wrap">
        {topPain && (
          <Badge color={topPainZone.color} bg={topPainZone.bg}>
            <AlertTriangle size={11} /> {painLocation(topPain)} {topPain.intensity}/10{pains.length > 1 ? ` +${pains.length - 1}` : ""}
          </Badge>
        )}
        <Badge color={readiness.color} bg={readiness.bg}>Readiness {readiness.label}</Badge>
        <Badge color={sleepHours.color} bg={sleepHours.bg}>Sleep {entry?.sleepHours !== null && entry?.sleepHours !== undefined ? `${entry.sleepHours}h` : "–"}</Badge>
        <Badge color={sleepQuality.color} bg={sleepQuality.bg}>Sleep quality {sleepQuality.label}</Badge>
        <Badge color={soreness.color} bg={soreness.bg}>Soreness {soreness.label}</Badge>
        <Badge color={stress.color} bg={stress.bg}>Stress {stress.label}</Badge>
      </div>
    </div>
  );
}

function DailyBatteryOverview({ roster, wellnessByPlayer, painByPlayer = {} }) {
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
        {rows.map((r) => <DailyBatteryRow key={r.name} name={r.name} entry={r.entry} pains={activePains(painByPlayer[r.name] || [])} />)}
      </div>
    </div>
  );
}

function PainOverview({ roster, painByPlayer }) {
  const rows = [];
  for (const p of roster) {
    for (const r of activePains(painByPlayer[p.name] || [])) rows.push({ player: p.name, report: r });
  }
  // strongest pain first
  rows.sort((a, b) => b.report.intensity - a.report.intensity);

  return (
    <div className="rounded-xl p-3 mb-5" style={{ background: C.surface1, border: `1px solid ${rows.length ? C.red : C.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted }}>Active pain reports</div>
        <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>{rows.length} active</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontFamily: fontBody, fontSize: 13, color: C.textMuted }}>No active pain reports.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map(({ player, report: r }) => {
            const z = painZone(r.intensity);
            return (
              <div key={`${player}|${painKey(r)}`} className="px-3 py-2.5 rounded-lg" style={{ background: C.surface2 }}>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span style={{ fontFamily: fontBody, fontSize: 13, color: C.text, fontWeight: 600 }}>{player}</span>
                  <span style={{ fontFamily: fontBody, fontSize: 13, color: C.text }}>{painLocation(r)}</span>
                  <Badge color={z.color} bg={z.bg}>{r.intensity}/10 · {z.label}</Badge>
                </div>
                <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted }}>
                  {(r.qualities || []).join(", ")} · {(r.timing || []).join(", ")}
                  {r.onset ? ` · ${r.onset === "sudden" ? "sudden onset" : "gradual onset"}` : ""}
                </div>
                {r.note ? (
                  <div style={{ fontFamily: fontBody, fontSize: 12, color: C.text, fontStyle: "italic", marginTop: 2 }}>“{r.note}”</div>
                ) : null}
                <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted, marginTop: 2 }}>Last update {fmtDateTime(r.ts)}</div>
              </div>
            );
          })}
        </div>
      )}
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
  const [readiness, setReadiness] = useState(3);
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
      setReadiness(existing?.readiness ?? 3);
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
    const entry = { date, sleepHours: sleepHours === "" ? null : hours, readiness, sleep, soreness, mood, stress };
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
        <div className="rounded-xl p-3" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
          <div className="mb-1" style={{ color: C.text, fontSize: 13, fontFamily: fontBody, fontWeight: 500 }}>Readiness</div>
          <div className="mb-2" style={{ color: C.textMuted, fontSize: 12, fontFamily: fontBody }}>
            How ready do you feel to train today, regardless of how long you slept? (1 not ready at all – 5 fully ready)
          </div>
          <ScaleButtons value={readiness} onChange={setReadiness} />
        </div>
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

  const restMarked = todaySessions.some(isRest);
  const hasRealSession = todaySessions.some((e) => !isRest(e));

  const toggleRest = async () => {
    setError("");
    setSaving(true);
    const entries = await getJSON(`entries:${name}`, []);
    const updated = restMarked
      ? entries.filter((e) => !(e.date === date && isRest(e)))
      : [...entries, { date, type: REST_TYPE, rpe: 0, duration: 0, load: 0 }].sort((a, b) => a.date.localeCompare(b.date));
    await setJSON(`entries:${name}`, updated);
    setSaving(false);
    setSaved(null);
    refreshToday(date);
    onSaved && onSaved();
  };

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
    // a real session replaces a rest-day marker for that date
    const filtered = entries.filter((e) => !(e.date === date && (e.type === type || isRest(e))));
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
                <span>{isRest(e) ? "no load" : `${e.load} AU`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasRealSession && (
        <div className="mb-5">
          <button type="button" onClick={toggleRest} disabled={saving} className="w-full rounded-xl py-3 font-semibold"
            style={{ background: restMarked ? C.surface1 : C.surface2, color: restMarked ? C.green : C.text, border: `1px solid ${restMarked ? C.green : C.border}`, fontFamily: fontDisplay, fontSize: 14 }}>
            {restMarked ? "Marked as rest day · tap to undo" : "Rest day – no training"}
          </button>
          <div className="flex items-center gap-3 mt-4" style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>
            <div style={{ flex: 1, height: 1, background: C.border }} />or log a session<div style={{ flex: 1, height: 1, background: C.border }} />
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

function Chip({ selected, onClick, children, color = C.accent }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg px-3 py-2 text-sm font-medium"
      style={{ fontFamily: fontBody, background: selected ? color : C.surface1, color: selected ? C.onRed : C.text, border: `1px solid ${selected ? color : C.border}` }}>
      {children}
    </button>
  );
}

function PainForm({ name, prefill, onSaved, onCancel }) {
  const [region, setRegion] = useState(prefill?.region || "");
  const [side, setSide] = useState(prefill?.side || "");
  const [intensity, setIntensity] = useState(prefill ? prefill.intensity : null);
  const [qualities, setQualities] = useState(prefill?.qualities || []);
  const [timing, setTiming] = useState(prefill?.timing || []);
  const [onset, setOnset] = useState(prefill?.onset || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const central = PAIN_CENTRAL.has(region);
  const severe = (intensity !== null && intensity >= 7) || qualities.includes("Tingling / numb");

  const submit = async () => {
    setError("");
    if (!region) { setError("Please select where it hurts."); return; }
    if (!central && !side) { setError("Please select the side (left, right or both)."); return; }
    if (intensity === null) { setError("Please rate the pain intensity."); return; }
    if (intensity === 0) { setError("0 means no pain. If the pain is gone, go back and tap “Mark as resolved” instead."); return; }
    if (!qualities.length) { setError("Please select at least one pain type."); return; }
    if (!timing.length) { setError("Please select when the pain occurs."); return; }

    setSaving(true);
    const list = await getJSON(`pain:${name}`, []);
    const now = new Date();
    const report = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: now.toISOString(),
      date: todayISO(),
      region,
      side: central ? "central" : side,
      intensity,
      qualities,
      timing,
      onset: onset || null,
      note: note.trim(),
      status: "active",
    };
    const ok = await setJSON(`pain:${name}`, [...list, report]);
    setSaving(false);
    if (!ok) { setError("Could not save. Please try again."); return; }
    onSaved();
  };

  const label = (t) => (
    <div className="mb-2" style={{ color: C.textMuted, fontSize: 12, fontFamily: fontBody }}>{t}</div>
  );

  return (
    <div>
      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 20, marginBottom: 4 }}>
        {prefill ? "Update pain report" : "Report pain"}
      </h2>
      <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 13, marginBottom: 20 }}>
        You can report pain at any time. It takes about a minute.
      </p>

      <div className="mb-5">
        {label("1 · Where does it hurt?")}
        <div className="flex flex-col gap-3">
          {PAIN_REGIONS.map((g) => (
            <div key={g.group}>
              <div style={{ color: C.textMuted, fontSize: 11, fontFamily: fontBody, marginBottom: 4 }}>{g.group}</div>
              <div className="flex flex-wrap gap-2">
                {g.items.map((i) => (
                  <Chip key={i.key} selected={region === i.key} onClick={() => { setRegion(i.key); if (i.central) setSide(""); }}>{i.key}</Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
        {region && !central && (
          <div className="mt-3">
            <div style={{ color: C.textMuted, fontSize: 11, fontFamily: fontBody, marginBottom: 4 }}>Side</div>
            <div className="flex gap-2">
              {PAIN_SIDES.map((s) => (
                <Chip key={s.key} selected={side === s.key} onClick={() => setSide(s.key)}>{s.label}</Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mb-5">
        {label("2 · How strong is the pain? (0 no pain – 10 worst pain imaginable)")}
        <div className="grid grid-cols-6 gap-2 mb-2">
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <button key={n} type="button" onClick={() => setIntensity(n)} className="rounded-lg py-2 text-sm font-semibold"
              style={{ fontFamily: fontMono, background: intensity === n ? C.accent : C.surface1, color: intensity === n ? C.onRed : C.text, border: `1px solid ${intensity === n ? C.accent : C.border}` }}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, minHeight: 16 }}>
          {intensity !== null ? painZone(intensity).label : "Tap a number"}
        </div>
      </div>

      <div className="mb-5">
        {label("3 · What does it feel like? (select all that apply)")}
        <div className="flex flex-wrap gap-2">
          {PAIN_QUALITIES.map((q) => (
            <Chip key={q} selected={qualities.includes(q)} onClick={() => toggle(qualities, setQualities, q)}>{q}</Chip>
          ))}
        </div>
      </div>

      <div className="mb-5">
        {label("4 · When does the pain occur? (select all that apply)")}
        <div className="flex flex-wrap gap-2">
          {PAIN_TIMING.map((t) => (
            <Chip key={t} selected={timing.includes(t)} onClick={() => toggle(timing, setTiming, t)}>{t}</Chip>
          ))}
        </div>
      </div>

      <div className="mb-5">
        {label("5 · How did it start? (optional)")}
        <div className="flex flex-col gap-2">
          {PAIN_ONSET.map((o) => (
            <Chip key={o.key} selected={onset === o.key} onClick={() => setOnset(onset === o.key ? "" : o.key)}>{o.label}</Chip>
          ))}
        </div>
      </div>

      <div className="mb-5">
        {label("6 · Anything else the staff should know? (optional)")}
        <textarea
          value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={3}
          className="rounded-lg px-3 py-2 w-full"
          style={{ background: C.surface1, color: C.text, border: `1px solid ${C.border}`, fontFamily: fontBody, fontSize: 14 }}
        />
      </div>

      {severe && (
        <div className="rounded-xl p-3 mb-4" style={{ background: C.redDark, color: C.red, fontFamily: fontBody, fontSize: 13 }}>
          This sounds significant. Please also tell the physio or medical staff directly – this tool is for monitoring and does not replace a medical assessment.
        </div>
      )}

      {error && <div style={{ color: C.red, fontFamily: fontBody, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <button onClick={submit} disabled={saving} className="w-full rounded-xl py-3 font-semibold"
        style={{ background: C.accent, color: C.onRed, fontFamily: fontDisplay, fontSize: 15 }}>
        {saving ? "Saving…" : "Send pain report"}
      </button>
      <button onClick={onCancel} className="w-full mt-2 py-2" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 13 }}>Cancel</button>

      <p style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted, marginTop: 12, textAlign: "center" }}>
        Your report is visible to the coaching and medical staff.
      </p>
    </div>
  );
}

function PainSection({ name, onChanged }) {
  const [view, setView] = useState("list"); // list | form
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [prefill, setPrefill] = useState(null);
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    setReports(await getJSON(`pain:${name}`, []));
    setLoading(false);
  }, [name]);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => activePains(reports), [reports]);

  const resolve = async (r) => {
    setBusyKey(painKey(r));
    const list = await getJSON(`pain:${name}`, []);
    const now = new Date();
    const marker = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: now.toISOString(), date: todayISO(),
      region: r.region, side: r.side, intensity: 0, status: "resolved",
    };
    await setJSON(`pain:${name}`, [...list, marker]);
    setBusyKey("");
    await load();
    onChanged && onChanged();
  };

  if (loading) return <div style={{ color: C.textMuted, fontFamily: fontBody }}>Loading…</div>;

  if (view === "form") {
    return (
      <PainForm
        name={name} prefill={prefill}
        onCancel={() => setView("list")}
        onSaved={async () => { setView("list"); await load(); onChanged && onChanged(); }}
      />
    );
  }

  return (
    <div>
      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 20, marginBottom: 4 }}>Pain reports</h2>
      <p style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 13, marginBottom: 16 }}>
        Report new pain at any time, update how it develops, and mark it as resolved when it's gone.
      </p>

      <button onClick={() => { setPrefill(null); setView("form"); }} className="w-full rounded-xl py-3 font-semibold mb-5"
        style={{ background: C.accent, color: C.onRed, fontFamily: fontDisplay, fontSize: 15 }}>
        Report new pain
      </button>

      <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
        Active ({active.length})
      </div>
      {active.length === 0 ? (
        <div className="rounded-xl p-4" style={{ background: C.surface1, border: `1px solid ${C.border}`, fontFamily: fontBody, fontSize: 13, color: C.textMuted }}>
          No active pain reports.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {active.map((r) => {
            const z = painZone(r.intensity);
            return (
              <div key={painKey(r)} className="rounded-xl p-4" style={{ background: C.surface1, border: `1px solid ${C.border}` }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 15, color: C.text }}>{painLocation(r)}</div>
                  <Badge color={z.color} bg={z.bg}>{r.intensity}/10 · {z.label}</Badge>
                </div>
                <div style={{ fontFamily: fontBody, fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                  {(r.qualities || []).join(", ")} · {(r.timing || []).join(", ")}
                </div>
                <div className="mb-3" style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>
                  Last update {fmtDateTime(r.ts)}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setPrefill(r); setView("form"); }} className="flex-1 rounded-lg py-2 text-sm font-medium"
                    style={{ background: C.surface2, border: `1px solid ${C.border}`, color: C.text, fontFamily: fontBody }}>
                    Update
                  </button>
                  <button onClick={() => resolve(r)} disabled={busyKey === painKey(r)} className="flex-1 rounded-lg py-2 text-sm font-medium"
                    style={{ background: C.greenDark, border: `1px solid ${C.border}`, color: C.green, fontFamily: fontBody }}>
                    {busyKey === painKey(r) ? "Saving…" : "Mark as resolved"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChangePinForm({ name, roster, setRoster, onDone }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (pin) => {
    const updated = roster.map((p) => (p.name === name ? { ...p, pinHash: hashPin(pin) } : p));
    setRoster(updated);
    const ok = await setJSON("roster", updated);
    if (ok) { setDone(true); setError(""); }
    else setError("Could not save. Try again.");
  };

  if (done) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Check size={16} color={C.green} />
          <span style={{ fontFamily: fontBody, color: C.text, fontSize: 13 }}>PIN updated. Use it next time you log in.</span>
        </div>
        <button onClick={onDone} className="rounded-xl px-4 py-2" style={{ background: C.surface1, border: `1px solid ${C.border}`, color: C.text, fontFamily: fontBody, fontSize: 13 }}>
          Back
        </button>
      </div>
    );
  }

  return (
    <PinPad title="Set a new PIN" subtitle="Pick a new 4+ digit PIN. It replaces your old one immediately." needsConfirm confirmLabel="Save new PIN" onSubmit={submit} error={error} onBack={onDone} />
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
  const [mode, setMode] = useState("hub"); // hub | wellness | session | pain | pin
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [activePainCount, setActivePainCount] = useState(0);

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

  const refreshPain = useCallback(async () => {
    const list = await getJSON(`pain:${name}`, []);
    setActivePainCount(activePains(list).length);
  }, [name]);

  useEffect(() => { if (authed) { refreshCheckin(); refreshPain(); } }, [authed, refreshCheckin, refreshPain]);

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
                <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>RPE, duration, load type · or mark a rest day</div>
              </div>
              <Activity size={20} color={C.accent} />
            </button>
            <button onClick={() => setMode("pain")} className="flex items-center justify-between rounded-xl px-5 py-4" style={{ background: C.surface1, border: `1px solid ${activePainCount > 0 ? C.red : C.border}` }}>
              <div className="text-left">
                <div style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 15 }}>Report pain</div>
                <div style={{ fontFamily: fontBody, color: C.textMuted, fontSize: 12 }}>
                  {activePainCount > 0 ? `${activePainCount} active — tap to update or resolve` : "Anytime: where, how strong, what type, when"}
                </div>
              </div>
              <AlertTriangle size={20} color={activePainCount > 0 ? C.red : C.brand} />
            </button>
          </div>

          <button onClick={() => setMode("pin")} className="flex items-center gap-2 mt-6" style={{ color: C.textMuted, fontFamily: fontBody, fontSize: 12 }}>
            <KeyRound size={13} /> Change my PIN
          </button>
        </>
      )}

      {mode === "wellness" && <WellnessForm name={name} onSaved={refreshCheckin} />}
      {mode === "session" && <SessionForm name={name} />}
      {mode === "pain" && <PainSection name={name} onChanged={refreshPain} />}
      {mode === "pin" && <ChangePinForm name={name} roster={roster} setRoster={setRoster} onDone={() => setMode("hub")} />}
    </div>
  );
}

// ---------- coach view ----------
function PlayerCard({ name, entries, wellness, pains = [], onRemove }) {
  const m = useMemo(() => computeMetrics(entries, wellness), [entries, wellness]);
  const zone = acwrZone(m.acwr, m.hasAnyData, m.acwrReady, m.baselineDays);
  const flagged = isFlagged(m);

  return (
    <div className="rounded-xl p-4" style={{ background: C.surface1, border: `1px solid ${flagged ? C.red : C.border}` }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 15, color: C.text }}>{name}</div>
          <Badge color={zone.color} bg={zone.bg}>{flagged && <AlertTriangle size={11} />} {zone.label}</Badge>
        </div>
        <button onClick={() => onRemove(name)} title="Remove from roster"><Trash2 size={14} color={C.textMuted} /></button>
      </div>

      {pains.length > 0 && (
        <div className="flex flex-col gap-1 mb-3">
          {pains.map((r) => {
            const z = painZone(r.intensity);
            return (
              <Badge key={painKey(r)} color={z.color} bg={z.bg}>
                <AlertTriangle size={11} /> {painLocation(r)} · {r.intensity}/10
              </Badge>
            );
          })}
        </div>
      )}

      <Sparkline data={m.dailyLoad} />

      <div className="grid grid-cols-3 gap-2 my-3">
        <div>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>Weekly load</div>
          <div style={{ fontFamily: fontMono, fontSize: 15, color: C.text, fontWeight: 600 }}>{Math.round(m.weeklyLoad)}</div>
        </div>
        <div>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>ACWR</div>
          <div style={{ fontFamily: fontMono, fontSize: 15, color: C.text, fontWeight: 600 }}>{m.hasAnyData && m.acwrReady ? m.acwr.toFixed(2) : "–"}</div>
        </div>
        <div>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>Monotony</div>
          <div style={{ fontFamily: fontMono, fontSize: 15, color: m.monotony > 2 ? C.amber : C.text, fontWeight: 600 }}>{m.hasAnyData ? m.monotony.toFixed(1) : "–"}</div>
        </div>
      </div>

      {m.hasAnyData && !m.acwrReady
        ? <BaselineBar days={m.baselineDays} />
        : <AcwrTrack acwr={m.acwr} hasData={m.hasAnyData} />}

      {m.gaps6 > 0 && (
        <div className="mt-2" style={{ fontFamily: fontBody, fontSize: 11, color: C.amber }}>
          {m.gaps6} of the last 6 days not logged (no session, no rest day)
        </div>
      )}

      {m.hasAnyData && (
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted, marginBottom: 6 }}>7-day load mix</div>
          <TypeMixBar breakdown={m.typeBreakdown} />
        </div>
      )}

      {(m.wellness.sleepHours || m.wellness.readiness || m.wellness.sleep || m.wellness.soreness || m.wellness.mood || m.wellness.stress) && (
        <div className="flex gap-3 mt-3 pt-3 flex-wrap" style={{ borderTop: `1px solid ${C.border}` }}>
          {m.wellness.readiness !== null && <div style={{ fontFamily: fontBody, fontSize: 11, color: C.textMuted }}>Readiness <span style={{ fontFamily: fontMono, color: C.text }}>{m.wellness.readiness.toFixed(1)}</span></div>}
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
  const [painByPlayer, setPainByPlayer] = useState({});
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
    const eMap = {}, wMap = {}, pMap = {};
    for (const p of r) {
      eMap[p.name] = await getJSON(`entries:${p.name}`, []);
      wMap[p.name] = await getJSON(`wellness:${p.name}`, []);
      pMap[p.name] = await getJSON(`pain:${p.name}`, []);
    }
    setEntriesByPlayer(eMap);
    setWellnessByPlayer(wMap);
    setPainByPlayer(pMap);
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
    // quote cells that contain the separator, quotes or line breaks (free-text notes!); BOM keeps umlauts intact in Excel
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\n");
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
    const rows = [["Name", "Date", "Readiness", "Sleep_hours", "Sleep_quality", "Soreness", "Mood", "Stress"]];
    for (const p of roster) {
      for (const w of wellnessByPlayer[p.name] || []) {
        rows.push([p.name, w.date, w.readiness ?? "", w.sleepHours ?? "", w.sleep, w.soreness, w.mood, w.stress]);
      }
    }
    downloadCSV(`load-monitor-wellness-${todayISO()}.csv`, rows);
  };

  const exportPainCSV = () => {
    const rows = [["Name", "Date", "Time_reported", "Region", "Side", "Status", "Intensity_NRS_0_10", "Pain_type", "When_it_occurs", "Onset", "Note"]];
    for (const p of roster) {
      for (const r of painByPlayer[p.name] || []) {
        rows.push([
          p.name, r.date, fmtDateTime(r.ts), r.region, r.side, r.status || "active", r.intensity,
          (r.qualities || []).join(" | "), (r.timing || []).join(" | "), r.onset || "", r.note || "",
        ]);
      }
    }
    downloadCSV(`load-monitor-pain-${todayISO()}.csv`, rows);
  };

  const teamStats = useMemo(() => {
    const today = todayISO();
    let loggedToday = 0, totalToday = 0, atRisk = 0, withPain = 0;
    const notLogged = [];
    const dailyByType = Array.from({ length: 28 }, () => {
      const o = {}; LOAD_TYPES.forEach((t) => { o[t.key] = 0; }); return o;
    });
    for (const p of roster) {
      if (activePains(painByPlayer[p.name] || []).length) withPain += 1;
      const entries = entriesByPlayer[p.name] || [];
      const todaySessions = entries.filter((e) => e.date === today);
      if (todaySessions.length) { loggedToday += 1; totalToday += todaySessions.reduce((a, e) => a + e.load, 0); }
      else notLogged.push(p.name);
      const m = computeMetrics(entries, wellnessByPlayer[p.name] || []);
      if (isFlagged(m)) atRisk += 1;
      m.dates.forEach((d, i) => {
        entries.filter((e) => e.date === d && !isRest(e)).forEach((e) => {
          dailyByType[i][e.type] = (dailyByType[i][e.type] || 0) + e.load;
        });
      });
    }
    return { loggedToday, totalToday, atRisk, withPain, dailyByType, notLogged };
  }, [roster, entriesByPlayer, wellnessByPlayer, painByPlayer]);

  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => {
      const ma = computeMetrics(entriesByPlayer[a.name] || [], wellnessByPlayer[a.name] || []);
      const mb = computeMetrics(entriesByPlayer[b.name] || [], wellnessByPlayer[b.name] || []);
      const riskA = isFlagged(ma) ? 1 : 0;
      const riskB = isFlagged(mb) ? 1 : 0;
      if (riskA !== riskB) return riskB - riskA;
      return a.name.localeCompare(b.name);
    });
  }, [roster, entriesByPlayer, wellnessByPlayer]);

  const chartData = teamStats.dailyByType.map((dayTypes, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (27 - i));
    return { label: fmtDateShort(toLocalISO(d)), ...dayTypes };
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
          <button onClick={exportPainCSV} className="flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ background: C.surface1, border: `1px solid ${C.border}`, color: C.text, fontFamily: fontBody, fontSize: 12 }}>
            <Download size={13} /> Pain
          </button>
        </div>
      </div>

      <h2 style={{ fontFamily: fontDisplay, fontWeight: 600, color: C.text, fontSize: 20, marginBottom: 16 }}>Team dashboard</h2>

      {loading ? (
        <div style={{ color: C.textMuted, fontFamily: fontBody }}>Loading data…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
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
            <div className="rounded-xl p-3" style={{ background: C.surface1 }}>
              <div style={{ fontFamily: fontBody, fontSize: 10, color: C.textMuted }}>Players with pain</div>
              <div style={{ fontFamily: fontMono, fontSize: 18, color: teamStats.withPain > 0 ? C.red : C.text, fontWeight: 600 }}>{teamStats.withPain}</div>
            </div>
          </div>
          {teamStats.notLogged.length > 0 && teamStats.notLogged.length < roster.length && (
            <div className="mb-5" style={{ fontFamily: fontBody, fontSize: 12, color: C.amber }}>
              Not logged yet today: {teamStats.notLogged.join(", ")}
            </div>
          )}

          <DailyBatteryOverview roster={roster} wellnessByPlayer={wellnessByPlayer} painByPlayer={painByPlayer} />

          <PainOverview roster={roster} painByPlayer={painByPlayer} />

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
                <PlayerCard key={p.name} name={p.name} entries={entriesByPlayer[p.name] || []} wellness={wellnessByPlayer[p.name] || []} pains={activePains(painByPlayer[p.name] || [])} onRemove={removePlayer} />
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
