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
    const engine = (body?.engine || "deepl").toLowerCase();

    if (!text || !targetLang) {
      return res.status(400).json({
        error: "Bad Request: 'text' and 'targetLang' are required",
        received: body ?? null
      });
    }

    /* ==========================
       CHATGPT
    ========================== */
    if (engine === "chatgpt") {
      const key = process.env.OPENAI_API_KEY;
      if (!key) {
        return res.status(500).json({ error: "OPENAI_API_KEY missing on server" });
      }

      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You are a professional translator. " +
                "Translate strictly without adding explanations. " +
                "Keep punctuation, casing, numbers, and formatting. " +
                "Output only the translated text."
            },
            {
              role: "user",
              content: `Target language: ${String(targetLang).toUpperCase()}\n\nText:\n${String(text)}`
            }
          ]
        })
      });

      const raw = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: raw });

      const data = JSON.parse(raw);
      const result = data?.choices?.[0]?.message?.content?.trim() ?? String(text);

      return res.status(200).json({ result });
    }

    /* ==========================
       DEEPL (header-based auth)
    ========================== */
    const key = process.env.DEEPL_KEY;
    if (!key) return res.status(500).json({ error: "DEEPL_KEY missing on server" });

    // ✅ Auto free/pro endpoint
    const isFree = /:fx$/i.test(key);
    const deeplUrl = isFree
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api.deepl.com/v2/translate";

    const params = new URLSearchParams();
    params.append("text", String(text));
    params.append("target_lang", String(targetLang).toUpperCase());

    const r = await fetch(deeplUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // ✅ NEW AUTH (no more auth_key in body)
        "Authorization": `DeepL-Auth-Key ${key}`
      },
      body: params.toString()
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
