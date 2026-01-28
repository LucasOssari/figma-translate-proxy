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

    // ✅ Obtenir le répertoire home (où on a les droits)
    const homeDir = await sftp.cwd();
    console.log(`Home directory: ${homeDir}`);

    // ✅ Utiliser SFTP_REMOTE_DIR ou le home
    let baseDir = process.env.SFTP_REMOTE_DIR || homeDir;
    
    // Si SFTP_REMOTE_DIR est relatif, le combiner avec home
    if (baseDir && !baseDir.startsWith('/')) {
      baseDir = `${homeDir}/${baseDir}`;
    }
    
    baseDir = baseDir.replace(/\/+/g, '/').replace(/\/$/, ''); // Nettoyer
    
    console.log(`Base directory: ${baseDir}`);

    // Construire les chemins finaux
    const folderPath = `${baseDir}/${folder}`;
    const remotePath = `${folderPath}/${filename}`;

    console.log(`Target folder: ${folderPath}`);
    console.log(`Target file: ${remotePath}`);

    // ✅ Vérifier si le dossier de base existe
    const baseDirExists = await sftp.exists(baseDir);
    console.log(`Base dir exists: ${baseDirExists}`);

    if (!baseDirExists) {
      console.log(`Creating base dir: ${baseDir}`);
      try {
        await sftp.mkdir(baseDir, true);
      } catch (e) {
        console.log(`Base dir creation error: ${e.message}`);
      }
    }

    // ✅ Créer le sous-dossier (ENCARTS_2026-01-28)
    const folderExists = await sftp.exists(folderPath);
    console.log(`Folder exists: ${folderExists}`);
    
    if (!folderExists) {
      console.log(`Creating folder: ${folderPath}`);
      try {
        await sftp.mkdir(folderPath, true);
        console.log(`Folder created successfully`);
      } catch (mkdirErr) {
        console.log(`Mkdir error: ${mkdirErr.message}`);
        // Si on ne peut pas créer, essayer d'uploader directement dans baseDir
        const fallbackPath = `${baseDir}/${filename}`;
        console.log(`Fallback: uploading to ${fallbackPath}`);
        await sftp.put(raw, fallbackPath);
        
        return res.status(200).json({
          ok: true,
          remotePath: fallbackPath,
          bytes: raw.length,
          warning: "Uploaded to base directory (no subfolder permissions)"
        });
      }
    }

    console.log(`Uploading ${raw.length} bytes to ${remotePath}...`);
    await sftp.put(raw, remotePath);
    console.log(`Upload successful`);

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
