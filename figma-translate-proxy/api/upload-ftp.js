import SftpClient from "ssh2-sftp-client";

export const config = {
  api: { bodyParser: false }
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
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

export default async function handler(req, res) {
  // ✅ CORS AVANT TOUT
  setCors(res);
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ✅ Vérification des variables d'environnement
    const host = process.env.SFTP_HOST;
    const port = Number(process.env.SFTP_PORT || 22);
    const username = process.env.SFTP_USER;
    const password = process.env.SFTP_PASS;
    const remoteDir = process.env.SFTP_REMOTE_DIR || "/uploads";

    console.log(`[FTP] Host: ${host}, User: ${username}, Port: ${port}`);

    if (!host || !username || !password) {
      console.error("[FTP] Missing SFTP credentials");
      return res.status(500).json({
        error: "SFTP env missing (SFTP_HOST/SFTP_USER/SFTP_PASS)",
        debug: {
          hasHost: !!host,
          hasUser: !!username,
          hasPass: !!password
        }
      });
    }

    // ✅ Récupération des paramètres
    const folder = sanitizeName(
      typeof req.query?.folder === "string" ? req.query.folder : "ENCARTS"
    );
    const filename = sanitizeName(
      typeof req.query?.name === "string" ? req.query.name : ""
    );

    if (!filename) {
      console.error("[FTP] Missing filename parameter");
      return res.status(400).json({ error: "Missing ?name=filename" });
    }

    console.log(`[FTP] Uploading: folder=${folder}, file=${filename}`);

    // ✅ Lecture du body
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    console.log(`[FTP] Content-Type: ${contentType}`);
    
    const raw = await readRawBody(req);
    console.log(`[FTP] Raw body size: ${raw.length} bytes`);

    let fileBuffer;

    // Option A: binaire direct (application/octet-stream) - RECOMMANDÉ
    if (contentType.includes("application/octet-stream")) {
      fileBuffer = raw;
      console.log(`[FTP] Using binary mode (octet-stream)`);
    } else {
      // Option B: JSON { bytes: number[] }
      console.log(`[FTP] Trying JSON mode...`);
      let payload = {};
      try {
        payload = JSON.parse(raw.toString("utf8") || "{}");
      } catch (parseErr) {
        console.error(`[FTP] JSON parse error:`, parseErr);
        return res.status(400).json({
          error: "Bad Request: cannot parse JSON",
          contentType,
          bodyPreview: raw.toString("utf8").slice(0, 100)
        });
      }

      const bytes = Array.isArray(payload?.bytes) ? payload.bytes : null;
      if (!bytes || !bytes.length) {
        console.error(`[FTP] No bytes array in payload`);
        return res.status(400).json({
          error: "Bad Request: expected { bytes: number[] }",
          receivedKeys: Object.keys(payload)
        });
      }

      fileBuffer = Buffer.from(Uint8Array.from(bytes));
      console.log(`[FTP] Converted from JSON bytes array`);
    }

    console.log(`[FTP] File buffer size: ${fileBuffer.length} bytes`);

    // ✅ Upload SFTP
    const folderPath = `${remoteDir}/${folder}`;
    const remotePath = `${folderPath}/${filename}`;

    console.log(`[FTP] Connecting to SFTP...`);
    const sftp = new SftpClient();
    
    await sftp.connect({ host, port, username, password });
    console.log(`[FTP] Connected!`);

    try {
      console.log(`[FTP] Creating directory: ${folderPath}`);
      await sftp.mkdir(folderPath, true);
    } catch (mkdirErr) {
      console.log(`[FTP] Directory already exists or creation failed (ignoring)`);
    }

    console.log(`[FTP] Uploading to: ${remotePath}`);
    await sftp.put(fileBuffer, remotePath);
    console.log(`[FTP] Upload successful!`);

    await sftp.end();
    console.log(`[FTP] Connection closed`);

    return res.status(200).json({
      ok: true,
      remotePath,
      bytes: fileBuffer.length,
      folder,
      filename
    });

  } catch (e) {
    console.error(`[FTP] ERROR:`, e);
    return res.status(500).json({ 
      error: String(e?.message || e),
      stack: process.env.NODE_ENV === "development" ? e?.stack : undefined
    });
  }
}
