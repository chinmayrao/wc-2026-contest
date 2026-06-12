export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const response = await fetch(
    "https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED",
    { headers: { "X-Auth-Token": "de14cffc719346ad8522827869bfcbcb" } }
  );
  const data = await response.json();
  res.status(200).json(data);
}