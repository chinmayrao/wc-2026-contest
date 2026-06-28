export default async function handler(req, res) {
  const SUPABASE_URL = "https://rxmdwwpovwzriokgiugk.supabase.co";
  const SUPABASE_KEY = "sb_publishable_lRtm75gVwNTAAWY_ty_Zvg_sUBwddpf";
  const SUPA_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };
  const FD_TOKEN = "de14cffc719346ad8522827869bfcbcb";

  const TEAM_NAME_FIX = {
    "United States": "USA", "Korea Republic": "South Korea",
    "Türkiye": "Turkey", "Turkey": "Turkey",
    "Czechia": "Czech Republic", "Czech Republic": "Czech Republic",
    "Curaçao": "Curacao", "Congo DR": "DR Congo",
    "Democratic Republic of the Congo": "DR Congo",
    "Cape Verde Islands": "Cape Verde", "IR Iran": "Iran",
  };

  function mapStage(stage) {
    if (!stage) return null;
    const s = stage.toUpperCase();
    if (s.includes("GROUP")) return "Group";
    if (s.includes("ROUND_OF_32") || s.includes("LAST_32")) return "R32";
    if (s.includes("ROUND_OF_16") || s.includes("LAST_16")) return "R16";
    if (s.includes("QUARTER")) return "QF";
    if (s.includes("SEMI")) return "SF";
    if (s.includes("FINAL") && !s.includes("SEMI")) return "Final";
    return null;
  }

  // Fuzzy matching helpers
  function normalize(s) {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.']/g, "").replace(/\s+/g, " ").trim();
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array(m+1).fill(null).map(() => Array(n+1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    return dp[m][n];
  }
  function stringSimilarity(a, b) {
    const na = normalize(a), nb = normalize(b);
    return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  }

  try {
    // 1. Fetch entries from Supabase
    const entriesRes = await fetch(`${SUPABASE_URL}/rest/v1/entries?select=*`, { headers: SUPA_HEADERS });
    const entries = await entriesRes.json();
    const allPickedStrikers = [...new Set(entries.flatMap(e => e.strikers || []))];

    // 2. Fetch match results from football-data.org (reliable, always up to date)
    const fdRes = await fetch("https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED", {
      headers: { "X-Auth-Token": FD_TOKEN }
    });
    const fdData = await fdRes.json();
    const fdMatches = fdData.matches || [];

    const newMatchResults = [];
    for (const match of fdMatches) {
      const stage = mapStage(match.stage);
      if (!stage) continue;
      const home = TEAM_NAME_FIX[match.homeTeam?.name] || match.homeTeam?.name;
      const away = TEAM_NAME_FIX[match.awayTeam?.name] || match.awayTeam?.name;
      const hs = match.score?.fullTime?.home ?? 0;
      const as2 = match.score?.fullTime?.away ?? 0;
      newMatchResults.push({ type: "match", team: home, stage, result: hs > as2 ? "W" : hs === as2 ? "D" : "L" });
      newMatchResults.push({ type: "match", team: away, stage, result: as2 > hs ? "W" : hs === as2 ? "D" : "L" });
    }

    // 3. Fetch scorer data from worldcup26.ir (has goalscorer names)
    const STRIKER_API_ALIASES = {
      "v. júnior": "Vinicius Jr", "vinicius júnior": "Vinicius Jr",
      "vinícius júnior": "Vinicius Jr", "v. jr": "Vinicius Jr",
      "neymar": "Neymar Jr", "neymar jr.": "Neymar Jr", "neymar jr": "Neymar Jr",
      "neymar da silva": "Neymar Jr",
      "h. son": "Son Heung-min", "heung-min son": "Son Heung-min",
      "son heung min": "Son Heung-min", "h.m. son": "Son Heung-min",
      "arling halnd": "Erling Haaland", "e. haaland": "Erling Haaland",
      "e. håland": "Erling Haaland", "erling halnd": "Erling Haaland",
      "hri kin": "Harry Kane", "h. kane": "Harry Kane", "hari kin": "Harry Kane",
      "livnl msi": "Lionel Messi", "l. messi": "Lionel Messi", "leo messi": "Lionel Messi",
      "aiash ivida": "Ayase Ueda", "a. ueda": "Ayase Ueda", "ayash ueda": "Ayase Ueda",
      "lviiz diaz": "Luis Díaz", "l. diaz": "Luis Díaz",
    };

    function parseScorers(str) {
      if (!str || str === "null") return [];
      const cleaned = str.replace(/^\{|\}$/g, "").replace(/[\u201c\u201d\u2018\u2019]/g, '"');
      const matches = cleaned.match(/"([^"]+)"/g) || [];
      return matches.map(m => m.replace(/"/g, ""));
    }

    function matchScorer(scorerEntry) {
      if (!scorerEntry) return null;
      if (scorerEntry.includes("(OG)") || scorerEntry.includes("(og)")) return null;
      const nameOnly = scorerEntry.replace(/\s+\d+[\+\d]*'.*$/, "").replace(/\([^)]*\)/g, "").trim();
      const lower = nameOnly.toLowerCase();

      // Check aliases
      if (STRIKER_API_ALIASES[lower] && allPickedStrikers.includes(STRIKER_API_ALIASES[lower])) {
        return STRIKER_API_ALIASES[lower];
      }
      // Exact match
      const exact = allPickedStrikers.find(s => s.toLowerCase() === lower);
      if (exact) return exact;
      // Last name match
      const lastName = lower.split(/\s+/).pop();
      if (lastName.length > 2) {
        const lastMatch = allPickedStrikers.find(s => s.toLowerCase().split(/\s+/).pop() === lastName);
        if (lastMatch) return lastMatch;
      }
      // Fuzzy match
      let bestMatch = null, bestScore = 0;
      for (const s of allPickedStrikers) {
        const fullSim = stringSimilarity(nameOnly, s);
        const scorerLast = normalize(nameOnly).split(/\s+/).pop() || "";
        const strikerLast = normalize(s).split(/\s+/).pop() || "";
        const lastSim = (scorerLast.length > 2 && strikerLast.length > 2) ? stringSimilarity(scorerLast, strikerLast) : 0;
        if (fullSim >= 0.65 && lastSim >= 0.6 && (fullSim + lastSim) > bestScore) {
          bestScore = fullSim + lastSim;
          bestMatch = s;
        }
      }
      if (bestMatch) return bestMatch;
      return null;
    }

    // Fetch existing goals from Supabase as backup
    const existingGoalsRes = await fetch(`${SUPABASE_URL}/rest/v1/results?type=eq.goal&select=*`, { headers: SUPA_HEADERS });
    const existingGoals = await existingGoalsRes.json();

    let scorerSource = "none";
    const scorerGoals = {};
    const debug = [];

    try {
      const wcRes = await fetch("https://worldcup26.ir/get/games");
      const wcData = await wcRes.json();
      const wcGames = (wcData.games || []).filter(g => g.finished === "TRUE");
      scorerSource = "worldcup26.ir";

      for (const game of wcGames) {
        const homeScorers = parseScorers(game.home_scorers);
        const awayScorers = parseScorers(game.away_scorers);
        if (homeScorers.length > 0 || awayScorers.length > 0) {
          const matched = [...homeScorers, ...awayScorers].map(s => ({ raw: s, match: matchScorer(s) }));
          debug.push({ match: (game.home_team_name_en || "?") + " vs " + (game.away_team_name_en || "?"), scorers: matched });
        }
        for (const s of [...homeScorers, ...awayScorers]) {
          const m = matchScorer(s);
          if (m) scorerGoals[m] = (scorerGoals[m] || 0) + 1;
        }
      }
    } catch (e) {
      scorerSource = "failed: " + e.message;
      // Preserve existing goal data from Supabase
      for (const g of existingGoals) {
        if (g.player && g.goals) {
          scorerGoals[g.player] = g.goals;
        }
      }
    }

    const newGoalResults = Object.entries(scorerGoals).map(([player, goals]) => ({
      type: "goal", player, goals, stage: "tournament"
    }));

    // Safety check
    const allNew = [...newMatchResults, ...newGoalResults];
    if (allNew.length === 0 && fdMatches.length === 0) {
      return res.status(200).json({ ok: false, error: "No data — keeping existing results" });
    }

    // Delete and replace
    await fetch(`${SUPABASE_URL}/rest/v1/results?id=gte.0`, { method: "DELETE", headers: SUPA_HEADERS });
    for (const r of allNew) {
      await fetch(`${SUPABASE_URL}/rest/v1/results`, { method: "POST", headers: SUPA_HEADERS, body: JSON.stringify(r) });
    }

    res.status(200).json({
      ok: true,
      matchSource: "football-data.org",
      scorerSource,
      games: fdMatches.length,
      results: allNew.length,
      scorers: scorerGoals,
      debug
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}