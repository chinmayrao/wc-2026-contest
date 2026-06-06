import { useState, useEffect } from "react";

// ─── DATA ────────────────────────────────────────────────────────────────────

const CONFEDERATIONS = {
  UEFA: ["France", "England", "Spain", "Germany", "Portugal", "Netherlands", "Belgium", "Italy", "Croatia", "Switzerland", "Austria", "Poland", "Denmark", "Serbia", "Scotland", "Ukraine"],
  CONMEBOL: ["Brazil", "Argentina", "Uruguay", "Colombia", "Ecuador", "Chile"],
  CONCACAF: ["USA", "Mexico", "Canada", "Costa Rica", "Jamaica", "Panama"],
  CAF: ["Morocco", "Senegal", "Nigeria", "Cameroon", "Egypt", "Ghana", "Tunisia", "Mali", "South Africa"],
  AFC: ["Japan", "South Korea", "Australia", "Saudi Arabia", "Iran", "Qatar", "Jordan", "Indonesia"],
  OFC: ["New Zealand"],
};

const ALL_TEAMS = Object.entries(CONFEDERATIONS).flatMap(([conf, teams]) =>
  teams.map((t) => ({ name: t, confederation: conf }))
);

// Top strikers pool (name, team, confederation)
const STRIKERS = [
  { name: "Kylian Mbappé", team: "France", confederation: "UEFA" },
  { name: "Erling Haaland", team: "Norway", confederation: "UEFA" },
  { name: "Harry Kane", team: "England", confederation: "UEFA" },
  { name: "Bukayo Saka", team: "England", confederation: "UEFA" },
  { name: "Lamine Yamal", team: "Spain", confederation: "UEFA" },
  { name: "Florian Wirtz", team: "Germany", confederation: "UEFA" },
  { name: "Pedri", team: "Spain", confederation: "UEFA" },
  { name: "Jude Bellingham", team: "England", confederation: "UEFA" },
  { name: "Vinicius Jr", team: "Brazil", confederation: "CONMEBOL" },
  { name: "Rodrygo", team: "Brazil", confederation: "CONMEBOL" },
  { name: "Lautaro Martínez", team: "Argentina", confederation: "CONMEBOL" },
  { name: "Julián Álvarez", team: "Argentina", confederation: "CONMEBOL" },
  { name: "Luis Díaz", team: "Colombia", confederation: "CONMEBOL" },
  { name: "Darwin Núñez", team: "Uruguay", confederation: "CONMEBOL" },
  { name: "Christian Pulisic", team: "USA", confederation: "CONCACAF" },
  { name: "Folarin Balogun", team: "USA", confederation: "CONCACAF" },
  { name: "Hirving Lozano", team: "Mexico", confederation: "CONCACAF" },
  { name: "Jonathan David", team: "Canada", confederation: "CONCACAF" },
  { name: "Victor Osimhen", team: "Nigeria", confederation: "CAF" },
  { name: "Achraf Hakimi", team: "Morocco", confederation: "CAF" },
  { name: "Sadio Mané", team: "Senegal", confederation: "CAF" },
  { name: "Mohamed Salah", team: "Egypt", confederation: "CAF" },
  { name: "Kaoru Mitoma", team: "Japan", confederation: "AFC" },
  { name: "Son Heung-min", team: "South Korea", confederation: "AFC" },
  { name: "Ayase Ueda", team: "Japan", confederation: "AFC" },
  { name: "Salem Al-Dawsari", team: "Saudi Arabia", confederation: "AFC" },
];

const STAGE_MULTIPLIERS = { Group: 1, R16: 2, QF: 3, SF: 4, Final: 5 };
const STAGES = ["Group", "R16", "QF", "SF", "Final"];

// ─── SCORING ─────────────────────────────────────────────────────────────────

function computeScores(entries, results) {
  return entries.map((entry) => {
    let teamPts = 0;
    let playerPts = 0;
    const breakdown = [];

    // Team points
    entry.teams.forEach(({ team, rank }) => {
      let pts = 0;
      results.forEach((r) => {
        if (r.team === team) {
          const mult = STAGE_MULTIPLIERS[r.stage] || 1;
          const rankMult = 11 - rank;
          if (r.result === "W") pts += mult * rankMult;
          else if (r.result === "D") pts += 0.5 * mult * rankMult;
        }
      });
      breakdown.push({ label: `${team} (Rank ${rank})`, pts });
      teamPts += pts;
    });

    // Striker points
    const strikerMults = [20, 15, 10];
    entry.strikers.forEach((striker, i) => {
      let goals = 0;
      results.forEach((r) => {
        if (r.type === "goal" && r.player === striker) goals += r.goals || 0;
      });
      const pts = goals * strikerMults[i];
      breakdown.push({ label: `S${i + 1}: ${striker} (${goals}g × ${strikerMults[i]})`, pts });
      playerPts += pts;
    });

    return {
      ...entry,
      teamPts,
      playerPts,
      total: teamPts + playerPts,
      breakdown,
    };
  });
}

// Tiebreaker: whose highest-ranked team progressed furthest
function tiebreak(a, b, results) {
  const stageOrder = { Group: 1, R16: 2, QF: 3, SF: 4, Final: 5 };
  const getFurthest = (entry) => {
    let best = 0;
    entry.teams.forEach(({ team, rank }) => {
      results.forEach((r) => {
        if (r.team === team && r.result !== "L") {
          const s = stageOrder[r.stage] || 0;
          if (s > best) best = s;
        }
      });
    });
    return best;
  };
  const aFurthest = getFurthest(a);
  const bFurthest = getFurthest(b);
  if (aFurthest !== bFurthest) return bFurthest - aFurthest;
  // secondary: rank of that team
  const getTopRank = (entry) => Math.min(...entry.teams.map((t) => t.rank));
  return getTopRank(a) - getTopRank(b);
}

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────

async function loadData(key) {
  try {
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}

async function saveData(key, val) {
  try { await window.storage.set(key, JSON.stringify(val), true); } catch (e) { console.error(e); }
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

const CONF_COLORS = {
  UEFA: "#3b82f6", CONMEBOL: "#10b981", CONCACAF: "#f59e0b",
  CAF: "#ef4444", AFC: "#8b5cf6", OFC: "#06b6d4",
};

function Badge({ conf }) {
  return (
    <span style={{
      background: CONF_COLORS[conf] + "22",
      color: CONF_COLORS[conf],
      border: `1px solid ${CONF_COLORS[conf]}44`,
      borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.05em", fontFamily: "monospace"
    }}>{conf}</span>
  );
}

// ─── ENTRY FORM ──────────────────────────────────────────────────────────────

function EntryForm({ onSubmit }) {
  const [name, setName] = useState("");
  const [teams, setTeams] = useState(Array(10).fill(""));
  const [strikers, setStrikers] = useState(["", "", ""]);
  const [errors, setErrors] = useState([]);
  const [submitted, setSubmitted] = useState(false);

  const confCount = (teamList) => {
    const counts = {};
    teamList.forEach((t) => {
      if (!t) return;
      const found = ALL_TEAMS.find((x) => x.name === t);
      if (found) counts[found.confederation] = (counts[found.confederation] || 0) + 1;
    });
    return counts;
  };

  const validate = () => {
    const errs = [];
    if (!name.trim()) errs.push("Please enter your name.");
    const filledTeams = teams.filter(Boolean);
    if (filledTeams.length !== 10) errs.push("Please pick exactly 10 teams.");
    if (new Set(filledTeams).size !== filledTeams.length) errs.push("Duplicate teams detected.");
    const counts = confCount(teams);
    Object.entries(counts).forEach(([c, n]) => {
      if (n > 5) errs.push(`Max 5 teams from ${c} (you have ${n}).`);
    });
    const filledStrikers = strikers.filter(Boolean);
    if (filledStrikers.length !== 3) errs.push("Please pick exactly 3 strikers.");
    if (new Set(filledStrikers).size !== filledStrikers.length) errs.push("Duplicate strikers detected.");
    const sConfs = strikers.map((s) => {
      const found = STRIKERS.find((x) => x.name === s);
      return found?.confederation;
    }).filter(Boolean);
    if (new Set(sConfs).size !== sConfs.filter(Boolean).length) errs.push("Strikers must be from different confederations.");
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    const entry = {
      id: Date.now(),
      name: name.trim(),
      teams: teams.map((t, i) => ({ team: t, rank: i + 1 })),
      strikers,
    };
    await onSubmit(entry);
    setSubmitted(true);
  };

  const counts = confCount(teams);
  const usedStrikerConfs = strikers.filter(Boolean).map((s) => STRIKERS.find((x) => x.name === s)?.confederation);

  if (submitted) return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>⚽</div>
      <h2 style={{ color: "#f0e6d3", fontFamily: "'Playfair Display', serif", fontSize: 28 }}>Entry Submitted!</h2>
      <p style={{ color: "#a89880" }}>Good luck, {name}. May your dark horses run wild.</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      <div style={{ marginBottom: 32 }}>
        <label style={labelStyle}>Your Name</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Chinmay" style={inputStyle} />
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <label style={labelStyle}>10 Teams — Ranked 1 to 10</label>
          <span style={{ fontSize: 12, color: "#a89880" }}>Max 5 per confederation</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {Object.entries(counts).map(([c, n]) => (
            <span key={c} style={{
              fontSize: 12, padding: "3px 8px", borderRadius: 4,
              background: n > 5 ? "#ef444422" : "#ffffff11",
              color: n > 5 ? "#ef4444" : "#a89880",
              border: `1px solid ${n > 5 ? "#ef444444" : "#ffffff11"}`
            }}>{c}: {n}/5</span>
          ))}
        </div>
        {teams.map((val, i) => {
          const found = ALL_TEAMS.find((x) => x.name === val);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 28, color: "#6b7280", fontFamily: "monospace", fontSize: 13 }}>#{i + 1}</span>
              <select value={val} onChange={e => {
                const n = [...teams]; n[i] = e.target.value; setTeams(n);
              }} style={{ ...inputStyle, flex: 1, margin: 0 }}>
                <option value="">— pick team —</option>
                {Object.entries(CONFEDERATIONS).map(([conf, tms]) => (
                  <optgroup key={conf} label={conf}>
                    {tms.map(t => (
                      <option key={t} value={t} disabled={teams.includes(t) && teams[i] !== t}>{t}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {found && <Badge conf={found.confederation} />}
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <label style={labelStyle}>3 Strikers — Different Confederations</label>
          <span style={{ fontSize: 12, color: "#a89880" }}>20 / 15 / 10 × goals</span>
        </div>
        {strikers.map((val, i) => {
          const found = STRIKERS.find((x) => x.name === val);
          const mults = [20, 15, 10];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 28, color: "#f59e0b", fontFamily: "monospace", fontSize: 13 }}>×{mults[i]}</span>
              <select value={val} onChange={e => {
                const n = [...strikers]; n[i] = e.target.value; setStrikers(n);
              }} style={{ ...inputStyle, flex: 1, margin: 0 }}>
                <option value="">— pick striker —</option>
                {Object.entries(
                  STRIKERS.reduce((acc, s) => {
                    if (!acc[s.confederation]) acc[s.confederation] = [];
                    acc[s.confederation].push(s);
                    return acc;
                  }, {})
                ).map(([conf, players]) => (
                  <optgroup key={conf} label={conf}>
                    {players.map(p => {
                      const confAlreadyUsed = usedStrikerConfs.includes(p.confederation) && strikers[i] !== p.name;
                      return (
                        <option key={p.name} value={p.name}
                          disabled={strikers.includes(p.name) && strikers[i] !== p.name || confAlreadyUsed}>
                          {p.name} ({p.team})
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
              {found && <Badge conf={found.confederation} />}
            </div>
          );
        })}
      </div>

      {errors.length > 0 && (
        <div style={{ background: "#ef444411", border: "1px solid #ef444433", borderRadius: 8, padding: "12px 16px", marginBottom: 20 }}>
          {errors.map((e, i) => <div key={i} style={{ color: "#ef4444", fontSize: 13, marginBottom: 4 }}>⚠ {e}</div>)}
        </div>
      )}

      <button onClick={handleSubmit} style={btnStyle}>
        Submit Entry →
      </button>
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

function Leaderboard({ entries, results }) {
  const scored = computeScores(entries, results)
    .sort((a, b) => b.total - a.total || tiebreak(a, b, results));

  if (!scored.length) return (
    <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
      No entries yet. Share the link!
    </div>
  );

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      {scored.map((entry, idx) => (
        <div key={entry.id} style={{
          background: idx === 0 ? "linear-gradient(135deg, #92400e22, #78350f11)" : "#ffffff08",
          border: `1px solid ${idx === 0 ? "#f59e0b44" : "#ffffff11"}`,
          borderRadius: 12, padding: "16px 20px", marginBottom: 12,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: idx === 0 ? 28 : 20,
                color: idx === 0 ? "#f59e0b" : "#6b7280",
                width: 32
              }}>#{idx + 1}</span>
              <div>
                <div style={{ color: "#f0e6d3", fontWeight: 700, fontSize: 16 }}>{entry.name}</div>
                <div style={{ fontSize: 12, color: "#a89880", marginTop: 2 }}>
                  Teams: {entry.teamPts.toFixed(1)} · Strikers: {entry.playerPts}
                </div>
              </div>
            </div>
            <div style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 28, fontWeight: 700,
              color: idx === 0 ? "#f59e0b" : "#f0e6d3"
            }}>{entry.total.toFixed(1)}</div>
          </div>

          <details style={{ marginTop: 12 }}>
            <summary style={{ color: "#6b7280", fontSize: 12, cursor: "pointer" }}>Breakdown</summary>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {entry.breakdown.filter(b => b.pts > 0).map((b, i) => (
                <span key={i} style={{
                  background: "#ffffff08", border: "1px solid #ffffff11",
                  borderRadius: 4, padding: "2px 8px", fontSize: 12, color: "#a89880"
                }}>{b.label}: <strong style={{ color: "#f0e6d3" }}>{b.pts}</strong></span>
              ))}
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────

function AdminPanel({ results, onAddResult, onClearResults, entries }) {
  const [team, setTeam] = useState("");
  const [stage, setStage] = useState("Group");
  const [result, setResult] = useState("W");
  const [goalPlayer, setGoalPlayer] = useState("");
  const [goalCount, setGoalCount] = useState(1);
  const [tab, setTab] = useState("match");
  const [pw, setPw] = useState("");
  const [auth, setAuth] = useState(false);

  if (!auth) return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "40px 16px" }}>
      <label style={labelStyle}>Admin Password</label>
      <input type="password" value={pw} onChange={e => setPw(e.target.value)}
        style={inputStyle} placeholder="Enter password" />
      <button onClick={() => { if (pw === "wc2026admin") setAuth(true); }}
        style={btnStyle}>Unlock</button>
    </div>
  );

  const addMatch = () => {
    if (!team || !stage || !result) return;
    onAddResult({ type: "match", team, stage, result, id: Date.now() });
    setTeam(""); setResult("W");
  };

  const addGoal = () => {
    if (!goalPlayer || !goalCount) return;
    onAddResult({ type: "goal", player: goalPlayer, goals: Number(goalCount), stage, id: Date.now() });
    setGoalPlayer(""); setGoalCount(1);
  };

  // All strikers from entries
  const allPickedStrikers = [...new Set(entries.flatMap(e => e.strikers))];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {["match", "goals", "log"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...tabBtnStyle, background: tab === t ? "#f59e0b" : "#ffffff11",
            color: tab === t ? "#1a1008" : "#a89880"
          }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === "match" && (
        <div>
          <label style={labelStyle}>Stage</label>
          <select value={stage} onChange={e => setStage(e.target.value)} style={inputStyle}>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
          <label style={labelStyle}>Team</label>
          <select value={team} onChange={e => setTeam(e.target.value)} style={inputStyle}>
            <option value="">— select team —</option>
            {Object.entries(CONFEDERATIONS).map(([conf, tms]) => (
              <optgroup key={conf} label={conf}>
                {tms.map(t => <option key={t}>{t}</option>)}
              </optgroup>
            ))}
          </select>
          <label style={labelStyle}>Result</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {["W", "D", "L"].map(r => (
              <button key={r} onClick={() => setResult(r)} style={{
                ...tabBtnStyle, flex: 1,
                background: result === r ? (r === "W" ? "#10b981" : r === "D" ? "#f59e0b" : "#ef4444") : "#ffffff11",
                color: result === r ? "#fff" : "#a89880"
              }}>{r === "W" ? "Win" : r === "D" ? "Draw" : "Loss"}</button>
            ))}
          </div>
          <button onClick={addMatch} style={btnStyle}>Add Result</button>
        </div>
      )}

      {tab === "goals" && (
        <div>
          <label style={labelStyle}>Stage</label>
          <select value={stage} onChange={e => setStage(e.target.value)} style={inputStyle}>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
          <label style={labelStyle}>Striker</label>
          <select value={goalPlayer} onChange={e => setGoalPlayer(e.target.value)} style={inputStyle}>
            <option value="">— select striker —</option>
            {allPickedStrikers.length > 0
              ? allPickedStrikers.map(s => <option key={s}>{s}</option>)
              : STRIKERS.map(s => <option key={s.name}>{s.name}</option>)
            }
          </select>
          <label style={labelStyle}>Goals Scored</label>
          <input type="number" min={1} value={goalCount} onChange={e => setGoalCount(e.target.value)} style={inputStyle} />
          <button onClick={addGoal} style={btnStyle}>Add Goals</button>
        </div>
      )}

      {tab === "log" && (
        <div>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#a89880", fontSize: 13 }}>{results.length} result(s) logged</span>
            <button onClick={onClearResults} style={{ ...tabBtnStyle, color: "#ef4444", background: "#ef444411" }}>Clear All</button>
          </div>
          {results.length === 0 && <div style={{ color: "#6b7280", fontSize: 13 }}>No results yet.</div>}
          {results.map((r, i) => (
            <div key={r.id || i} style={{
              background: "#ffffff08", border: "1px solid #ffffff11",
              borderRadius: 8, padding: "8px 12px", marginBottom: 8,
              fontSize: 13, color: "#a89880", display: "flex", justifyContent: "space-between"
            }}>
              {r.type === "match"
                ? <span><strong style={{ color: "#f0e6d3" }}>{r.team}</strong> · {r.stage} · <span style={{ color: r.result === "W" ? "#10b981" : r.result === "D" ? "#f59e0b" : "#ef4444" }}>{r.result}</span></span>
                : <span><strong style={{ color: "#f0e6d3" }}>{r.player}</strong> · {r.goals} goal{r.goals > 1 ? "s" : ""} · {r.stage}</span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ENTRIES LIST ─────────────────────────────────────────────────────────────

function EntriesList({ entries }) {
  const [pw, setPw] = useState("");
  const [auth, setAuth] = useState(false);

  if (!auth) return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "40px 16px" }}>
      <label style={labelStyle}>Admin Password</label>
      <input type="password" value={pw} onChange={e => setPw(e.target.value)}
        style={inputStyle} placeholder="Enter password" />
      <button onClick={() => { if (pw === "wc2026admin") setAuth(true); }}
        style={btnStyle}>Unlock</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      <div style={{ color: "#a89880", fontSize: 13, marginBottom: 16 }}>{entries.length} entries submitted</div>
      {entries.map((entry) => (
        <div key={entry.id} style={{
          background: "#ffffff08", border: "1px solid #ffffff11",
          borderRadius: 12, padding: "16px 20px", marginBottom: 12
        }}>
          <div style={{ color: "#f0e6d3", fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{entry.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {entry.teams.map(({ team, rank }) => {
              const found = ALL_TEAMS.find(x => x.name === team);
              return (
                <span key={team} style={{
                  background: "#ffffff08", border: "1px solid #ffffff15",
                  borderRadius: 4, padding: "2px 8px", fontSize: 12, color: "#a89880"
                }}>#{rank} {team} {found && <span style={{ color: CONF_COLORS[found.confederation], fontSize: 10 }}>({found.confederation})</span>}</span>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {entry.strikers.map((s, i) => {
              const found = STRIKERS.find(x => x.name === s);
              const mults = [20, 15, 10];
              return (
                <span key={s} style={{
                  background: "#f59e0b11", border: "1px solid #f59e0b33",
                  borderRadius: 4, padding: "2px 8px", fontSize: 12, color: "#f59e0b"
                }}>×{mults[i]} {s}</span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const inputStyle = {
  width: "100%", background: "#ffffff0d", border: "1px solid #ffffff22",
  borderRadius: 8, padding: "10px 14px", color: "#f0e6d3", fontSize: 14,
  outline: "none", marginBottom: 16, boxSizing: "border-box",
  fontFamily: "inherit", appearance: "auto"
};
const labelStyle = {
  display: "block", color: "#a89880", fontSize: 12, fontWeight: 700,
  letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8
};
const btnStyle = {
  width: "100%", padding: "12px 24px", background: "#f59e0b",
  color: "#1a1008", border: "none", borderRadius: 8, fontWeight: 800,
  fontSize: 15, cursor: "pointer", letterSpacing: "0.03em"
};
const tabBtnStyle = {
  padding: "8px 16px", borderRadius: 6, border: "none",
  cursor: "pointer", fontSize: 13, fontWeight: 600
};

// ─── APP ─────────────────────────────────────────────────────────────────────

const TABS = ["Enter", "Leaderboard", "Entries", "Admin"];

export default function App() {
  const [tab, setTab] = useState("Enter");
  const [entries, setEntries] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const e = await loadData("wc2026:entries");
      const r = await loadData("wc2026:results");
      if (e) setEntries(e);
      if (r) setResults(r);
      setLoading(false);
    })();
  }, []);

  const handleSubmit = async (entry) => {
    const updated = [...entries, entry];
    setEntries(updated);
    await saveData("wc2026:entries", updated);
  };

  const handleAddResult = async (result) => {
    const updated = [...results, result];
    setResults(updated);
    await saveData("wc2026:results", updated);
  };

  const handleClearResults = async () => {
    setResults([]);
    await saveData("wc2026:results", []);
  };

  if (loading) return (
    <div style={{ background: "#0e0b07", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#f59e0b", fontFamily: "'Playfair Display', serif", fontSize: 24 }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ background: "#0e0b07", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", color: "#f0e6d3" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(180deg, #1a1008 0%, #0e0b07 100%)",
        borderBottom: "1px solid #ffffff11", padding: "28px 24px 20px",
        textAlign: "center"
      }}>
        <div style={{ fontSize: 36, marginBottom: 4 }}>🏆</div>
        <h1 style={{
          fontFamily: "'Playfair Display', serif", fontSize: 28,
          color: "#f59e0b", margin: "0 0 4px", letterSpacing: "-0.01em"
        }}>FIFA World Cup 2026</h1>
        <p style={{ color: "#a89880", fontSize: 13, margin: 0 }}>Pick 10 teams · 3 strikers · May the best punter win</p>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", borderBottom: "1px solid #ffffff11", overflowX: "auto" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "14px 8px", background: "none",
            border: "none", borderBottom: `2px solid ${tab === t ? "#f59e0b" : "transparent"}`,
            color: tab === t ? "#f59e0b" : "#6b7280", fontSize: 13,
            fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap"
          }}>{t}</button>
        ))}
      </div>

      {/* Rules pill */}
      {tab === "Enter" && (
        <div style={{ maxWidth: 680, margin: "20px auto 0", padding: "0 16px" }}>
          <div style={{
            background: "#f59e0b0d", border: "1px solid #f59e0b22",
            borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#a89880",
            lineHeight: 1.7
          }}>
            <strong style={{ color: "#f59e0b" }}>Rules:</strong> Rank 10 teams (max 5 from any confederation).
            Each win scores <strong style={{ color: "#f0e6d3" }}>(11−rank) × stage multiplier</strong> · draws score half.
            Stage multipliers: Group×1, R16×2, QF×3, SF×4, Final×5.
            Pick 3 strikers from <em>different confederations</em>: Striker 1 = 20×goals, S2 = 15×, S3 = 10×.
          </div>
        </div>
      )}

      <div style={{ paddingTop: 24 }}>
        {tab === "Enter" && <EntryForm onSubmit={handleSubmit} />}
        {tab === "Leaderboard" && <Leaderboard entries={entries} results={results} />}
        {tab === "Entries" && <EntriesList entries={entries} />}
        {tab === "Admin" && <AdminPanel results={results} onAddResult={handleAddResult} onClearResults={handleClearResults} entries={entries} />}
      </div>
    </div>
  );
}
//updated
