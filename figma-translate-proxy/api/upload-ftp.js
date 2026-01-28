import SftpClient from 'ssh2-sftp-client';

export const config = {
  api: { 
    bodyParser: false,
    responseLimit: '10mb'
  }
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sanitizeName(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
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
    const remoteDir = process.env.SFTP_REMOTE_DIR || "/";

    if (!SFTP_HOST || !SFTP_USER || !SFTP_PASS) {
      return res.status(500).json({ error: "SFTP credentials not configured" });
    }

    const folder = sanitizeName(req.query.folder || "ENCARTS");
    const filename = sanitizeName(req.query.name || "");

    if (!filename) {
      return res.status(400).json({ error: "Missing filename" });
    }

    const raw = await readRawBody(req);
    
    if (raw.length === 0) {
      return res.status(400).json({ error: "Empty file" });
    }

    console.log(`Connecting to SFTP: ${SFTP_USER}@${SFTP_HOST}:${port}`);
    
    await sftp.connect({
      host: SFTP_HOST,
      port,
      username: SFTP_USER,
      password: SFTP_PASS,
      readyTimeout: 20000,
      retries: 2
    });

    // ✅ Normaliser le chemin (supprimer les doubles slashes)
    const folderPath = `${remoteDir}/${folder}`.replace(/\/+/g, '/');
    const remotePath = `${folderPath}/${filename}`.replace(/\/+/g, '/');

    console.log(`Target folder: ${folderPath}`);
    console.log(`Target file: ${remotePath}`);

    // ✅ Créer le dossier avec mkdir récursif
    try {
      const exists = await sftp.exists(folderPath);
      console.log(`Folder exists: ${exists}`);
      
      if (!exists) {
        console.log(`Creating folder: ${folderPath}`);
        await sftp.mkdir(folderPath, true); // ✅ true = récursif
        console.log(`Folder created successfully`);
      }
    } catch (mkdirErr) {
      console.log(`Mkdir warning: ${mkdirErr.message}`);
      // Continue anyway, the folder might exist
    }

    console.log(`Uploading ${raw.length} bytes...`);
    
    // ✅ Upload avec Buffer directement
    await sftp.put(raw, remotePath);
    
    console.log(`Upload successful: ${remotePath}`);

    return res.status(200).json({
      ok: true,
      remotePath,
      bytes: raw.length
    });

  } catch (e) {
    console.error("SFTP error:", e);
    return res.status(500).json({ 
      error: e.message || String(e),
      code: e.code || 'UNKNOWN'
    });
  } finally {
    try {
      await sftp.end();
    } catch (e) {
      console.error("SFTP close error:", e);
    }
  }
}
