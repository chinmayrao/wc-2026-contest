export default async function handler(req, res) {
  const SUPABASE_URL = "https://rxmdwwpovwzriokgiugk.supabase.co";
  const SUPABASE_KEY = "sb_publishable_lRtm75gVwNTAAWY_ty_Zvg_sUBwddpf";
  const SUPA_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  try {
    // Fetch games from worldcup26.ir
    const gamesRes = await fetch("https://worldcup26.ir/get/games");
    const gamesData = await gamesRes.json();
    const games = (gamesData.games || []).filter(g => g.finished === "TRUE");

    // Fetch all entries from Supabase to know picked strikers
    const entriesRes = await fetch(`${SUPABASE_URL}/rest/v1/entries?select=*`, { headers: SUPA_HEADERS });
    const entries = await entriesRes.json();
    const allPickedStrikers = [...new Set(entries.flatMap(e => e.strikers || []))];

    function getStage(game) {
      const t = (game.type || "").toLowerCase();
      if (t === "group") return "Group";
      if (t.includes("32")) return "R32";
      if (t.includes("16")) return "R16";
      if (t.includes("quarter")) return "QF";
      if (t.includes("semi")) return "SF";
      if (t.includes("final") && !t.includes("semi")) return "Final";
      return "Group";
    }

    function parseScorers(str) {
      if (!str || str === "null") return [];
      const cleaned = str.replace(/^\{|\}$/g, "").replace(/[\u201c\u201d\u2018\u2019]/g, '"');
      const matches = cleaned.match(/"([^"]+)"/g) || [];
      return matches.map(m => m.replace(/"/g, ""));
    }

    // API name → our striker name overrides (for cases where last-name match fails)
    const STRIKER_API_ALIASES = {
      "v. júnior": "Vinicius Jr",
      "vinicius júnior": "Vinicius Jr",
      "vinícius júnior": "Vinicius Jr",
      "v. jr": "Vinicius Jr",
    };

    function matchScorer(scorerEntry) {
      if (!scorerEntry) return null;
      if (scorerEntry.includes("(OG)") || scorerEntry.includes("(og)")) return null;
      const nameOnly = scorerEntry.replace(/\d+'.*$/, "").replace(/\([^)]*\)/g, "").trim();
      const lower = nameOnly.toLowerCase();
      // Check aliases first
      if (STRIKER_API_ALIASES[lower] && allPickedStrikers.includes(STRIKER_API_ALIASES[lower])) {
        return STRIKER_API_ALIASES[lower];
      }
      const exact = allPickedStrikers.find(s => s.toLowerCase() === lower);
      if (exact) return exact;
      const lastName = lower.split(/\s+/).pop();
      if (lastName.length > 2) {
        const lastMatch = allPickedStrikers.find(s => {
          const sLast = s.toLowerCase().split(/\s+/).pop();
          return sLast === lastName;
        });
        if (lastMatch) return lastMatch;
      }
      return null;
    }

    const newMatchResults = [];
    const scorerGoals = {};

    for (const game of games) {
      const stage = getStage(game);
      const home = game.home_team_name_en;
      const away = game.away_team_name_en;
      const hScore = parseInt(game.home_score || "0");
      const aScore = parseInt(game.away_score || "0");

      newMatchResults.push({ type: "match", team: home, stage, result: hScore > aScore ? "W" : hScore === aScore ? "D" : "L" });
      newMatchResults.push({ type: "match", team: away, stage, result: aScore > hScore ? "W" : hScore === aScore ? "D" : "L" });

      const homeScorers = parseScorers(game.home_scorers);
      const awayScorers = parseScorers(game.away_scorers);
      for (const s of [...homeScorers, ...awayScorers]) {
        const matched = matchScorer(s);
        if (matched) scorerGoals[matched] = (scorerGoals[matched] || 0) + 1;
      }
    }

    const newGoalResults = Object.entries(scorerGoals).map(([player, goals]) => ({
      type: "goal", player, goals, stage: "tournament"
    }));

    // Delete all existing results
    await fetch(`${SUPABASE_URL}/rest/v1/results?id=gte.0`, { method: "DELETE", headers: SUPA_HEADERS });

    // Insert new results
    for (const r of [...newMatchResults, ...newGoalResults]) {
      await fetch(`${SUPABASE_URL}/rest/v1/results`, { method: "POST", headers: SUPA_HEADERS, body: JSON.stringify(r) });
    }

    res.status(200).json({ ok: true, games: games.length, results: newMatchResults.length + newGoalResults.length, scorers: Object.keys(scorerGoals) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}