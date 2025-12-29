export default async function handler(req, res) {
  // --- CORS (Figma origin = "null") ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, targetLang } = req.body || {};

    if (!text || !targetLang) {
      return res.status(400).json({ error: "text and targetLang are required" });
    }

    const key = process.env.DEEPL_KEY;
    if (!key) {
      return res.status(500).json({ error: "DEEPL_KEY missing on server" });
    }

    const endpoint =
      process.env.DEEPL_ENDPOINT || "https://api-free.deepl.com/v2/translate";

    const params = new URLSearchParams();
    params.append("auth_key", key);
    params.append("text", text);
    params.append("target_lang", String(targetLang).toUpperCase());

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const raw = await r.text();
    if (!r.ok) {
      return res.status(r.status).json({ error: raw });
    }

    const data = JSON.parse(raw);
    const result = data?.translations?.[0]?.text ?? text;

    return res.status(200).json({ result });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
