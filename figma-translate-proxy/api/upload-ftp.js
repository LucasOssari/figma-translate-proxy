import SftpClient from "ssh2-sftp-client";

export const config = {
  api: { 
    bodyParser: false,
    responseLimit: '10mb'
  }
};

export default async function handler(req, res) {
  // ✅ CORS EN PREMIER - AVANT TOUT
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  
  // ✅ OPTIONS doit retourner 200 immédiatement
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sftp = new SftpClient();
  
  try {
    const { SFTP_HOST, SFTP_USER, SFTP_PASS } = process.env;
    const port = Number(process.env.SFTP_PORT || 22);
    const remoteDir = process.env.SFTP_REMOTE_DIR || "/uploads";

    if (!SFTP_HOST || !SFTP_USER || !SFTP_PASS) {
      return res.status(500).json({ error: "SFTP not configured" });
    }

    const folder = sanitizeName(
      typeof req.query?.folder === "string" ? req.query.folder : "ENCARTS"
    );
    const filename = sanitizeName(
      typeof req.query?.name === "string" ? req.query.name : ""
    );

    if (!filename) {
      return res.status(400).json({ error: "Missing filename" });
    }

    const raw = await readRawBody(req);
    
    if (raw.length === 0) {
      return res.status(400).json({ error: "Empty file" });
    }

    // Connexion SFTP
    await sftp.connect({
      host: SFTP_HOST,
      port,
      username: SFTP_USER,
      password: SFTP_PASS,
      readyTimeout: 20000,
      retries: 2
    });

    const folderPath = `${remoteDir}/${folder}`;
    const remotePath = `${folderPath}/${filename}`;

    // Créer le dossier si nécessaire
    const exists = await sftp.exists(folderPath);
    if (!exists) {
      await sftp.mkdir(folderPath, true);
    }

    // Upload
    await sftp.put(raw, remotePath);

    return res.status(200).json({
      ok: true,
      remotePath,
      bytes: raw.length
    });

  } catch (e) {
    console.error("SFTP error:", e);
    return res.status(500).json({ 
      error: e.message || String(e),
      details: e.code || 'UNKNOWN'
    });
  } finally {
    try {
      await sftp.end();
    } catch (e) {
      console.error("SFTP close error:", e);
    }
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function sanitizeName(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
