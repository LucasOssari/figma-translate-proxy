export default async function handler(req, res) {
  // CORS (safe pour Figma)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, targetLang } = req.body || {};

    if (!text || !targetLang) {
      return res.status(400).json({ error: "text and targetLang are required" });
    }

    if (!process.env.DEEPL_KEY) {
      return res.status(500).json({ error: "DEEPL_KEY missing on server" });
    }

    const params = new URLSearchParams();
    params.append("auth_key", process.env.DEEPL_KEY);
    params.append("text", text);
    params.append("target_lang", targetLang.toUpperCase());

    const response = await fetch(
      "https://api-free.deepl.com/v2/translate",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    );

    const raw = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({ error: raw });
    }

    const data = JSON.parse(raw);
    const result = data?.translations?.[0]?.text ?? text;

    return res.status(200).json({ result });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
