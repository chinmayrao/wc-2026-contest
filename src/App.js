import { useState, useEffect } from "react";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://rxmdwwpovwzriokgiugk.supabase.co";
const SUPABASE_KEY = "sb_publishable_lRtm75gVwNTAAWY_ty_Zvg_sUBwddpf";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function getEntries() { return sbFetch("entries?select=*&order=created_at.asc"); }
async function addEntry(entry) { return sbFetch("entries", { method: "POST", body: JSON.stringify(entry) }); }
async function getResults() { return sbFetch("results?select=*&order=created_at.asc"); }
async function addResult(result) { return sbFetch("results", { method: "POST", body: JSON.stringify(result) }); }
async function deleteAllResults() { return sbFetch("results?id=gte.0", { method: "DELETE" }); }

// ─── FOOTBALL-DATA.ORG API ────────────────────────────────────────────────────
const FD_TOKEN = "de14cffc719346ad8522827869bfcbcb";
const FD_BASE = "https://api.football-data.org/v4";

async function fdFetch(path) {
  const res = await fetch(`/api/sync`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Map football-data.org team names → our app names
const TEAM_NAME_MAP = {
  "France": "France", "England": "England", "Spain": "Spain",
  "Germany": "Germany", "Portugal": "Portugal", "Netherlands": "Netherlands",
  "Belgium": "Belgium", "Croatia": "Croatia", "Switzerland": "Switzerland",
  "Austria": "Austria", "Scotland": "Scotland", "Sweden": "Sweden",
  "Türkiye": "Turkey", "Turkey": "Turkey",
  "Czech Republic": "Czech Republic", "Czechia": "Czech Republic",
  "Bosnia and Herzegovina": "Bosnia and Herzegovina",
  "Norway": "Norway",
  "Brazil": "Brazil", "Argentina": "Argentina", "Uruguay": "Uruguay",
  "Colombia": "Colombia", "Ecuador": "Ecuador", "Paraguay": "Paraguay",
  "United States": "USA", "USA": "USA", "Mexico": "Mexico", "Canada": "Canada",
  "Panama": "Panama", "Haiti": "Haiti", "Curaçao": "Curacao", "Curacao": "Curacao",
  "Morocco": "Morocco", "Senegal": "Senegal", "Nigeria": "Nigeria",
  "Egypt": "Egypt", "Mali": "Mali", "Algeria": "Algeria", "Tunisia": "Tunisia",
  "DR Congo": "DR Congo", "Congo DR": "DR Congo",
  "Cape Verde": "Cape Verde", "Cape Verde Islands": "Cape Verde",
  "South Africa": "South Africa",
  "Japan": "Japan", "Korea Republic": "South Korea", "South Korea": "South Korea",
  "Australia": "Australia", "Saudi Arabia": "Saudi Arabia", "Iran": "Iran",
  "Jordan": "Jordan", "Uzbekistan": "Uzbekistan", "Indonesia": "Indonesia",
  "New Zealand": "New Zealand",
};

// Map stage names from API → our stage names
function mapStage(stage) {
  if (!stage) return null;
  const s = stage.toUpperCase();
  if (s.includes("GROUP")) return "Group";
  if (s.includes("ROUND_OF_32") || s.includes("LAST_32")) return "R32";
  if (s.includes("ROUND_OF_16") || s.includes("LAST_16")) return "R16";
  if (s.includes("QUARTER")) return "QF";
  if (s.includes("SEMI")) return "SF";
  if (s.includes("FINAL")) return "Final";
  return null;
}

// Map scorer names from API → our striker names (fuzzy last name match)
function matchScorerName(apiName, ourStrikers) {
  if (!apiName) return null;
  const api = apiName.toLowerCase().trim();
  // Try exact match first
  const exact = ourStrikers.find(s => s.toLowerCase() === api);
  if (exact) return exact;
  // Try last name match
  const apiLast = api.split(" ").pop();
  const lastMatch = ourStrikers.find(s => s.toLowerCase().split(" ").pop() === apiLast);
  if (lastMatch) return lastMatch;
  // Try first word match (handles "Mbappé" vs "Kylian Mbappé")
  const apiFirst = api.split(" ")[0];
  const firstMatch = ourStrikers.find(s => s.toLowerCase().includes(apiFirst));
  if (firstMatch) return firstMatch;
  return null;
}

async function syncFromAPI(allEntries) {
  // Fetch all WC matches
  const data = await fdFetch("/competitions/WC/matches?status=FINISHED");
  const matches = data.matches || [];

  const allPickedStrikers = [...new Set(allEntries.flatMap(e => e.strikers))];
  const newResults = [];
  const scorerGoals = {}; // strikerName -> total goals

  for (const match of matches) {
    const stage = mapStage(match.stage);
    if (!stage) continue;

    const homeTeam = TEAM_NAME_MAP[match.homeTeam?.name] || match.homeTeam?.name;
    const awayTeam = TEAM_NAME_MAP[match.awayTeam?.name] || match.awayTeam?.name;
    const homeScore = match.score?.fullTime?.home ?? 0;
    const awayScore = match.score?.fullTime?.away ?? 0;

    if (homeTeam) {
      newResults.push({
        type: "match", team: homeTeam, stage,
        result: homeScore > awayScore ? "W" : homeScore === awayScore ? "D" : "L"
      });
    }
    if (awayTeam) {
      newResults.push({
        type: "match", team: awayTeam, stage,
        result: awayScore > homeScore ? "W" : homeScore === awayScore ? "D" : "L"
      });
    }

    // Goalscorers
    const goals = match.goals || [];
    for (const goal of goals) {
      if (goal.type === "OWN_GOAL") continue;
      const scorerName = goal.scorer?.name;
      const matched = matchScorerName(scorerName, allPickedStrikers);
      if (matched) {
        scorerGoals[matched] = (scorerGoals[matched] || 0) + 1;
      }
    }
  }

  // Add goal events
  for (const [player, goals] of Object.entries(scorerGoals)) {
    newResults.push({ type: "goal", player, goals, stage: "tournament" });
  }

  // Replace all results in Supabase
  await deleteAllResults();
  for (const r of newResults) {
    await addResult(r);
  }

  return { matchCount: matches.length, resultCount: newResults.length };
}

// ─── DATA ────────────────────────────────────────────────────────────────────

const CONFEDERATIONS = {
  UEFA: ["France", "England", "Spain", "Germany", "Portugal", "Netherlands", "Belgium", "Croatia", "Switzerland", "Austria", "Scotland", "Sweden", "Turkey", "Czech Republic", "Bosnia and Herzegovina", "Norway"],
  CONMEBOL: ["Brazil", "Argentina", "Uruguay", "Colombia", "Ecuador", "Paraguay"],
  CONCACAF: ["USA", "Mexico", "Canada", "Panama", "Haiti", "Curacao"],
  CAF: ["Morocco", "Senegal", "Nigeria", "Egypt", "Mali", "Algeria", "Tunisia", "DR Congo", "Cape Verde", "South Africa"],
  AFC: ["Japan", "South Korea", "Australia", "Saudi Arabia", "Iran", "Jordan", "Uzbekistan", "Indonesia"],
  OFC: ["New Zealand"],
};

const ALL_TEAMS = Object.entries(CONFEDERATIONS).flatMap(([conf, teams]) =>
  teams.map((t) => ({ name: t, confederation: conf }))
);

const STRIKERS = [
  { name: "Kylian Mbappé", team: "France", confederation: "UEFA" },
  { name: "Marcus Thuram", team: "France", confederation: "UEFA" },
  { name: "Harry Kane", team: "England", confederation: "UEFA" },
  { name: "Bukayo Saka", team: "England", confederation: "UEFA" },
  { name: "Jude Bellingham", team: "England", confederation: "UEFA" },
  { name: "Lamine Yamal", team: "Spain", confederation: "UEFA" },
  { name: "Mikel Oyarzabal", team: "Spain", confederation: "UEFA" },
  { name: "Florian Wirtz", team: "Germany", confederation: "UEFA" },
  { name: "Jamal Musiala", team: "Germany", confederation: "UEFA" },
  { name: "Bruno Fernandes", team: "Portugal", confederation: "UEFA" },
  { name: "Erling Haaland", team: "Norway", confederation: "UEFA" },
  { name: "Memphis Depay", team: "Netherlands", confederation: "UEFA" },
  { name: "Donyell Malen", team: "Netherlands", confederation: "UEFA" },
  { name: "Romelu Lukaku", team: "Belgium", confederation: "UEFA" },
  { name: "Lois Openda", team: "Belgium", confederation: "UEFA" },
  { name: "Andrej Kramaric", team: "Croatia", confederation: "UEFA" },
  { name: "Breel Embolo", team: "Switzerland", confederation: "UEFA" },
  { name: "Christoph Baumgartner", team: "Austria", confederation: "UEFA" },
  { name: "Scott McTominay", team: "Scotland", confederation: "UEFA" },
  { name: "Viktor Gyokeres", team: "Sweden", confederation: "UEFA" },
  { name: "Kerem Akturkoglu", team: "Turkey", confederation: "UEFA" },
  { name: "Yusuf Yazici", team: "Turkey", confederation: "UEFA" },
  { name: "Patrik Schick", team: "Czech Republic", confederation: "UEFA" },
  { name: "Ermedin Demirovic", team: "Bosnia and Herzegovina", confederation: "UEFA" },
  { name: "Neymar Jr", team: "Brazil", confederation: "CONMEBOL" },
  { name: "Vinicius Jr", team: "Brazil", confederation: "CONMEBOL" },
  { name: "Endrick", team: "Brazil", confederation: "CONMEBOL" },
  { name: "Matheus Cunha", team: "Brazil", confederation: "CONMEBOL" },
  { name: "Raphinha", team: "Brazil", confederation: "CONMEBOL" },
  { name: "Lionel Messi", team: "Argentina", confederation: "CONMEBOL" },
  { name: "Lautaro Martínez", team: "Argentina", confederation: "CONMEBOL" },
  { name: "Julián Álvarez", team: "Argentina", confederation: "CONMEBOL" },
  { name: "Luis Díaz", team: "Colombia", confederation: "CONMEBOL" },
  { name: "James Rodríguez", team: "Colombia", confederation: "CONMEBOL" },
  { name: "Darwin Núñez", team: "Uruguay", confederation: "CONMEBOL" },
  { name: "Facundo Torres", team: "Uruguay", confederation: "CONMEBOL" },
  { name: "Enner Valencia", team: "Ecuador", confederation: "CONMEBOL" },
  { name: "Miguel Almirón", team: "Paraguay", confederation: "CONMEBOL" },
  { name: "Christian Pulisic", team: "USA", confederation: "CONCACAF" },
  { name: "Folarin Balogun", team: "USA", confederation: "CONCACAF" },
  { name: "Ricardo Pepi", team: "USA", confederation: "CONCACAF" },
  { name: "Raúl Jiménez", team: "Mexico", confederation: "CONCACAF" },
  { name: "Hirving Lozano", team: "Mexico", confederation: "CONCACAF" },
  { name: "Jonathan David", team: "Canada", confederation: "CONCACAF" },
  { name: "Alphonso Davies", team: "Canada", confederation: "CONCACAF" },
  { name: "Achraf Hakimi", team: "Morocco", confederation: "CAF" },
  { name: "Youssef En-Nesyri", team: "Morocco", confederation: "CAF" },
  { name: "Mohamed Salah", team: "Egypt", confederation: "CAF" },
  { name: "Omar Marmoush", team: "Egypt", confederation: "CAF" },
  { name: "Victor Osimhen", team: "Nigeria", confederation: "CAF" },
  { name: "Sadio Mané", team: "Senegal", confederation: "CAF" },
  { name: "Lyle Foster", team: "South Africa", confederation: "CAF" },
  { name: "Evidence Makgopa", team: "South Africa", confederation: "CAF" },
  { name: "Serhou Guirassy", team: "Mali", confederation: "CAF" },
  { name: "Islam Slimani", team: "Algeria", confederation: "CAF" },
  { name: "Son Heung-min", team: "South Korea", confederation: "AFC" },
  { name: "Ayase Ueda", team: "Japan", confederation: "AFC" },
  { name: "Ritsu Doan", team: "Japan", confederation: "AFC" },
  { name: "Mehdi Taremi", team: "Iran", confederation: "AFC" },
  { name: "Salem Al-Dawsari", team: "Saudi Arabia", confederation: "AFC" },
  { name: "Mousa Tamari", team: "Jordan", confederation: "AFC" },
  { name: "Eldor Shomurodov", team: "Uzbekistan", confederation: "AFC" },
  { name: "Chris Wood", team: "New Zealand", confederation: "OFC" },
];

const STAGE_MULTIPLIERS = { Group: 1, R32: 2, R16: 3, QF: 4, SF: 5, Final: 6 };
const STAGES = ["Group", "R32", "R16", "QF", "SF", "Final"];

// ─── SCORING ─────────────────────────────────────────────────────────────────

function computeScores(entries, results) {
  return entries.map((entry) => {
    let teamPts = 0, playerPts = 0;
    const breakdown = [];
    entry.teams.forEach(({ team, rank }) => {
      let pts = 0;
      results.forEach((r) => {
        if (r.type === "match" && r.team === team) {
          const mult = STAGE_MULTIPLIERS[r.stage] || 1;
          const rankMult = 11 - rank;
          if (r.result === "W") pts += mult * rankMult;
          else if (r.result === "D") pts += 0.5 * mult * rankMult;
        }
      });
      breakdown.push({ label: `${team} (Rank ${rank})`, pts });
      teamPts += pts;
    });
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
    return { ...entry, teamPts, playerPts, total: teamPts + playerPts, breakdown };
  });
}

function tiebreak(a, b, results) {
  const stageOrder = { Group: 1, R32: 2, R16: 3, QF: 4, SF: 5, Final: 6 };
  const getFurthest = (entry) => {
    let best = 0;
    entry.teams.forEach(({ team }) => {
      results.forEach((r) => {
        if (r.type === "match" && r.team === team && r.result !== "L") {
          const s = stageOrder[r.stage] || 0;
          if (s > best) best = s;
        }
      });
    });
    return best;
  };
  const aF = getFurthest(a), bF = getFurthest(b);
  if (aF !== bF) return bF - aF;
  return Math.min(...a.teams.map(t => t.rank)) - Math.min(...b.teams.map(t => t.rank));
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

const CONF_COLORS = {
  UEFA: "#3b82f6", CONMEBOL: "#10b981", CONCACAF: "#f59e0b",
  CAF: "#ef4444", AFC: "#8b5cf6", OFC: "#06b6d4",
};

function Badge({ conf }) {
  return (
    <span style={{
      background: CONF_COLORS[conf] + "22", color: CONF_COLORS[conf],
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
  const [submitting, setSubmitting] = useState(false);

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
    const sConfs = strikers.map((s) => STRIKERS.find((x) => x.name === s)?.confederation).filter(Boolean);
    if (new Set(sConfs).size !== sConfs.length) errs.push("Strikers must be from different confederations.");
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), teams: teams.map((t, i) => ({ team: t, rank: i + 1 })), strikers });
      setSubmitted(true);
    } catch (e) {
      setErrors(["Failed to submit. Please try again."]);
    }
    setSubmitting(false);
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
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Chinmay" style={inputStyle} />
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
              <select value={val} onChange={e => { const n = [...teams]; n[i] = e.target.value; setTeams(n); }}
                style={{ ...inputStyle, flex: 1, margin: 0 }}>
                <option value="">— pick team —</option>
                {Object.entries(CONFEDERATIONS).map(([conf, tms]) => (
                  <optgroup key={conf} label={conf}>
                    {tms.map(t => <option key={t} value={t} disabled={teams.includes(t) && teams[i] !== t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
              {found && <Badge conf={found.confederation} />}
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <label style={labelStyle}>3 Strikers — Different Confederations</label>
          <span style={{ fontSize: 12, color: "#a89880" }}>20 / 15 / 10 × goals</span>
        </div>
        <div style={{
          background: "#f59e0b0d", border: "1px solid #f59e0b22",
          borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#a89880", lineHeight: 1.7, marginBottom: 12
        }}>
          <strong style={{ color: "#f59e0b" }}>Striker rules:</strong> Pick 3 strikers from <em>different confederations</em>.
          Striker 1 = <strong style={{ color: "#f0e6d3" }}>20 × goals</strong>, Striker 2 = <strong style={{ color: "#f0e6d3" }}>15 × goals</strong>, Striker 3 = <strong style={{ color: "#f0e6d3" }}>10 × goals</strong>.
        </div>
        {strikers.map((val, i) => {
          const found = STRIKERS.find((x) => x.name === val);
          const mults = [20, 15, 10];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 28, color: "#f59e0b", fontFamily: "monospace", fontSize: 13 }}>×{mults[i]}</span>
              <select value={val} onChange={e => { const n = [...strikers]; n[i] = e.target.value; setStrikers(n); }}
                style={{ ...inputStyle, flex: 1, margin: 0 }}>
                <option value="">— pick striker —</option>
                {Object.entries(STRIKERS.reduce((acc, s) => {
                  if (!acc[s.confederation]) acc[s.confederation] = [];
                  acc[s.confederation].push(s); return acc;
                }, {})).map(([conf, players]) => (
                  <optgroup key={conf} label={conf}>
                    {players.map(p => {
                      const confAlreadyUsed = usedStrikerConfs.includes(p.confederation) && strikers[i] !== p.name;
                      return <option key={p.name} value={p.name}
                        disabled={strikers.includes(p.name) && strikers[i] !== p.name || confAlreadyUsed}>
                        {p.name} ({p.team})</option>;
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
      <button onClick={handleSubmit} disabled={submitting} style={{ ...btnStyle, opacity: submitting ? 0.7 : 1 }}>
        {submitting ? "Submitting…" : "Submit Entry →"}
      </button>
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

function Leaderboard({ entries, results }) {
  const scored = computeScores(entries, results).sort((a, b) => b.total - a.total || tiebreak(a, b, results));
  if (!scored.length) return <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>No entries yet. Share the link!</div>;
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
              <span style={{ fontFamily: "'Playfair Display', serif", fontSize: idx === 0 ? 28 : 20, color: idx === 0 ? "#f59e0b" : "#6b7280", width: 32 }}>#{idx + 1}</span>
              <div>
                <div style={{ color: "#f0e6d3", fontWeight: 700, fontSize: 16 }}>{entry.name}</div>
                <div style={{ fontSize: 12, color: "#a89880", marginTop: 2 }}>Teams: {entry.teamPts.toFixed(1)} · Strikers: {entry.playerPts}</div>
              </div>
            </div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 700, color: idx === 0 ? "#f59e0b" : "#f0e6d3" }}>{entry.total.toFixed(1)}</div>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary style={{ color: "#6b7280", fontSize: 12, cursor: "pointer" }}>Breakdown</summary>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {entry.breakdown.filter(b => b.pts > 0).map((b, i) => (
                <span key={i} style={{ background: "#ffffff08", border: "1px solid #ffffff11", borderRadius: 4, padding: "2px 8px", fontSize: 12, color: "#a89880" }}>
                  {b.label}: <strong style={{ color: "#f0e6d3" }}>{b.pts}</strong>
                </span>
              ))}
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────

function AdminPanel({ results, onAddResult, onClearResults, entries, onSync }) {
  const [team, setTeam] = useState("");
  const [stage, setStage] = useState("Group");
  const [result, setResult] = useState("W");
  const [goalPlayer, setGoalPlayer] = useState("");
  const [goalCount, setGoalCount] = useState(1);
  const [tab, setTab] = useState("sync");
  const [pw, setPw] = useState("");
  const [auth, setAuth] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  if (!auth) return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "40px 16px" }}>
      <label style={labelStyle}>Admin Password</label>
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} style={inputStyle} placeholder="Enter password" />
      <button onClick={() => { if (pw === "wc2026admin") setAuth(true); }} style={btnStyle}>Unlock</button>
    </div>
  );

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const { matchCount, resultCount } = await onSync();
      setSyncMsg(`✅ Synced ${matchCount} matches → ${resultCount} results updated. ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setSyncMsg(`❌ Sync failed: ${e.message}`);
    }
    setSyncing(false);
  };

  const addMatch = async () => {
    if (!team || !stage || !result) return;
    setSaving(true);
    await onAddResult({ type: "match", team, stage, result });
    setSaving(false);
    setTeam("");
  };

  const addGoal = async () => {
    if (!goalPlayer || !goalCount) return;
    setSaving(true);
    await onAddResult({ type: "goal", player: goalPlayer, goals: Number(goalCount), stage });
    setSaving(false);
    setGoalPlayer(""); setGoalCount(1);
  };

  const allPickedStrikers = [...new Set(entries.flatMap(e => e.strikers))];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {["sync", "manual", "log"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...tabBtnStyle, background: tab === t ? "#f59e0b" : "#ffffff11",
            color: tab === t ? "#1a1008" : "#a89880"
          }}>{t === "sync" ? "🔄 Auto Sync" : t === "manual" ? "✏️ Manual" : "📋 Log"}</button>
        ))}
      </div>

      {tab === "sync" && (
        <div>
          <div style={{ background: "#ffffff08", border: "1px solid #ffffff11", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
            <div style={{ color: "#f0e6d3", fontWeight: 700, marginBottom: 8 }}>Auto-sync from football-data.org</div>
            <div style={{ color: "#a89880", fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              Fetches all completed WC matches, calculates W/D/L per team per stage, and counts goals for your picked strikers. Replaces all existing results.
            </div>
            <button onClick={handleSync} disabled={syncing} style={{ ...btnStyle, opacity: syncing ? 0.7 : 1 }}>
              {syncing ? "Syncing…" : "🔄 Sync Results Now"}
            </button>
            {syncMsg && (
              <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, fontSize: 13,
                background: syncMsg.startsWith("✅") ? "#10b98122" : "#ef444422",
                color: syncMsg.startsWith("✅") ? "#10b981" : "#ef4444",
                border: `1px solid ${syncMsg.startsWith("✅") ? "#10b98144" : "#ef444444"}`
              }}>{syncMsg}</div>
            )}
          </div>
        </div>
      )}

      {tab === "manual" && (
        <div>
          <div style={{ color: "#a89880", fontSize: 12, marginBottom: 16 }}>Use this for overrides or corrections only.</div>
          <label style={labelStyle}>Stage</label>
          <select value={stage} onChange={e => setStage(e.target.value)} style={inputStyle}>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
          <label style={labelStyle}>Team</label>
          <select value={team} onChange={e => setTeam(e.target.value)} style={inputStyle}>
            <option value="">— select team —</option>
            {Object.entries(CONFEDERATIONS).map(([conf, tms]) => (
              <optgroup key={conf} label={conf}>{tms.map(t => <option key={t}>{t}</option>)}</optgroup>
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
          <button onClick={addMatch} disabled={saving} style={{ ...btnStyle, marginBottom: 32, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Add Match Result"}
          </button>

          <label style={labelStyle}>Striker Goals</label>
          <select value={goalPlayer} onChange={e => setGoalPlayer(e.target.value)} style={inputStyle}>
            <option value="">— select striker —</option>
            {allPickedStrikers.map(s => <option key={s}>{s}</option>)}
          </select>
          <input type="number" min={1} value={goalCount} onChange={e => setGoalCount(e.target.value)} style={inputStyle} />
          <button onClick={addGoal} disabled={saving} style={{ ...btnStyle, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Add Goals"}
          </button>
        </div>
      )}

      {tab === "log" && (
        <div>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#a89880", fontSize: 13 }}>{results.length} result(s)</span>
            <button onClick={onClearResults} style={{ ...tabBtnStyle, color: "#ef4444", background: "#ef444411" }}>Clear All</button>
          </div>
          {results.length === 0 && <div style={{ color: "#6b7280", fontSize: 13 }}>No results yet.</div>}
          {results.map((r, i) => (
            <div key={r.id || i} style={{ background: "#ffffff08", border: "1px solid #ffffff11", borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 13, color: "#a89880" }}>
              {r.type === "match"
                ? <span><strong style={{ color: "#f0e6d3" }}>{r.team}</strong> · {r.stage} · <span style={{ color: r.result === "W" ? "#10b981" : r.result === "D" ? "#f59e0b" : "#ef4444" }}>{r.result}</span></span>
                : <span><strong style={{ color: "#f0e6d3" }}>{r.player}</strong> · {r.goals} goal{r.goals > 1 ? "s" : ""}</span>
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
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} style={inputStyle} placeholder="Enter password" />
      <button onClick={() => { if (pw === "wc2026admin") setAuth(true); }} style={btnStyle}>Unlock</button>
    </div>
  );
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px 40px" }}>
      <div style={{ color: "#a89880", fontSize: 13, marginBottom: 16 }}>{entries.length} entries submitted</div>
      {entries.map((entry) => (
        <div key={entry.id} style={{ background: "#ffffff08", border: "1px solid #ffffff11", borderRadius: 12, padding: "16px 20px", marginBottom: 12 }}>
          <div style={{ color: "#f0e6d3", fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{entry.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {entry.teams.map(({ team, rank }) => {
              const found = ALL_TEAMS.find(x => x.name === team);
              return (
                <span key={team} style={{ background: "#ffffff08", border: "1px solid #ffffff15", borderRadius: 4, padding: "2px 8px", fontSize: 12, color: "#a89880" }}>
                  #{rank} {team} {found && <span style={{ color: CONF_COLORS[found.confederation], fontSize: 10 }}>({found.confederation})</span>}
                </span>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {entry.strikers.map((s, i) => (
              <span key={s} style={{ background: "#f59e0b11", border: "1px solid #f59e0b33", borderRadius: 4, padding: "2px 8px", fontSize: 12, color: "#f59e0b" }}>
                ×{[20, 15, 10][i]} {s}
              </span>
            ))}
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
  outline: "none", marginBottom: 16, boxSizing: "border-box", fontFamily: "inherit", appearance: "auto"
};
const labelStyle = { display: "block", color: "#a89880", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 };
const btnStyle = { width: "100%", padding: "12px 24px", background: "#f59e0b", color: "#1a1008", border: "none", borderRadius: 8, fontWeight: 800, fontSize: 15, cursor: "pointer", letterSpacing: "0.03em" };
const tabBtnStyle = { padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 };

// ─── APP ─────────────────────────────────────────────────────────────────────

const TABS = ["Enter", "Leaderboard", "Entries", "Admin"];

export default function App() {
  const [tab, setTab] = useState("Enter");
  const [entries, setEntries] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    try {
      const [e, r] = await Promise.all([getEntries(), getResults()]);
      setEntries(e); setResults(r);
    } catch (err) { console.error("Load error:", err); }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { const i = setInterval(loadAll, 30000); return () => clearInterval(i); }, []);

  const handleSubmit = async (entry) => { await addEntry(entry); await loadAll(); };
  const handleAddResult = async (result) => { await addResult(result); await loadAll(); };
  const handleClearResults = async () => { await deleteAllResults(); await loadAll(); };
  const handleSync = async () => { const stats = await syncFromAPI(entries); await loadAll(); return stats; };

  if (loading) return (
    <div style={{ background: "#0e0b07", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#f59e0b", fontFamily: "'Playfair Display', serif", fontSize: 24 }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ background: "#0e0b07", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", color: "#f0e6d3" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={{ background: "linear-gradient(180deg, #1a1008 0%, #0e0b07 100%)", borderBottom: "1px solid #ffffff11", padding: "28px 24px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 4 }}>🏆</div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, color: "#f59e0b", margin: "0 0 4px" }}>FIFA World Cup 2026</h1>
        <p style={{ color: "#a89880", fontSize: 13, margin: 0 }}>Pick 10 teams · 3 strikers · May the best punter win</p>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #ffffff11", overflowX: "auto" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => { setTab(t); loadAll(); }} style={{
            flex: 1, padding: "14px 8px", background: "none", border: "none",
            borderBottom: `2px solid ${tab === t ? "#f59e0b" : "transparent"}`,
            color: tab === t ? "#f59e0b" : "#6b7280", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap"
          }}>{t}</button>
        ))}
      </div>
      {tab === "Enter" && (
        <div style={{ maxWidth: 680, margin: "20px auto 0", padding: "0 16px" }}>
          <div style={{ background: "#f59e0b0d", border: "1px solid #f59e0b22", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#a89880", lineHeight: 1.7 }}>
            <strong style={{ color: "#f59e0b" }}>Rules:</strong> Rank 10 teams (max 5 from any confederation).
            Each win scores <strong style={{ color: "#f0e6d3" }}>(11−rank) × stage multiplier</strong> · draws score half.
            Stage multipliers: Group×1, R32×2, R16×3, QF×4, SF×5, Final×6.
            Pick 3 strikers from <em>different confederations</em>: Striker 1 = 20×goals, S2 = 15×, S3 = 10×.
          </div>
        </div>
      )}
      <div style={{ paddingTop: 24 }}>
        {tab === "Enter" && <EntryForm onSubmit={handleSubmit} />}
        {tab === "Leaderboard" && <Leaderboard entries={entries} results={results} />}
        {tab === "Entries" && <EntriesList entries={entries} />}
        {tab === "Admin" && <AdminPanel results={results} onAddResult={handleAddResult} onClearResults={handleClearResults} entries={entries} onSync={handleSync} />}
      </div>
    </div>
  );
}
// updated