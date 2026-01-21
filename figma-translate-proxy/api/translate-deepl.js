export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body;
    if (!body || typeof body === "string") {
      try {
        body = body ? JSON.parse(body) : {};
      } catch {
        body = {};
      }
    }

    const text = body?.text;
    const targetLang = body?.targetLang;

    if (!text || !targetLang) {
      return res.status(400).json({
        error: "Bad Request: 'text' and 'targetLang' are required",
        received: body ?? null
      });
    }

    const key = process.env.DEEPL_KEY;
    if (!key) return res.status(500).json({ error: "DEEPL_KEY missing on server" });

    const params = new URLSearchParams();
    params.append("auth_key", key);
    params.append("text", String(text));
    params.append("target_lang", String(targetLang).toUpperCase());

    const r = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: raw });

    const data = JSON.parse(raw);
    const result = data?.translations?.[0]?.text ?? String(text);

    return res.status(200).json({ result });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
