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
    .replace(/\s+/g, "_")
    .trim();
}

async function ensureDirectory(sftp, dirPath) {
  const normalizedPath = dirPath.replace(/\/+/g, '/').replace(/\/$/, '');
  
  try {
    const exists = await sftp.exists(normalizedPath);
    if (exists) {
      console.log(`Directory already exists: ${normalizedPath}`);
      return true;
    }
  } catch (e) {
    console.log(`Check exists error: ${e.message}`);
  }

  const parts = normalizedPath.split('/').filter(Boolean);
  
  let currentPath = normalizedPath.startsWith('/') ? '/' : '';
  
  for (const part of parts) {
    currentPath += (currentPath === '/' ? '' : '/') + part;
    
    try {
      const exists = await sftp.exists(currentPath);
      if (!exists) {
        console.log(`Creating directory: ${currentPath}`);
        await sftp.mkdir(currentPath);
        console.log(`✅ Created: ${currentPath}`);
      } else {
        console.log(`Already exists: ${currentPath}`);
      }
    } catch (mkdirErr) {
      console.log(`Mkdir attempt for ${currentPath}: ${mkdirErr.message}`);
      
      try {
        const nowExists = await sftp.exists(currentPath);
        if (!nowExists) {
          throw new Error(`Cannot create directory: ${currentPath} - ${mkdirErr.message}`);
        }
      } catch (checkErr) {
        console.error(`Failed to create ${currentPath}: ${checkErr.message}`);
        throw checkErr;
      }
    }
  }
  
  return true;
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

    console.log(`Connecting to SFTP: ${SFTP_USER}@${SFTP_HOST}:${port}`);
    
    await sftp.connect({
      host: SFTP_HOST,
      port,
      username: SFTP_USER,
      password: SFTP_PASS,
      readyTimeout: 20000,
      retries: 2
    });

    const homeDir = await sftp.cwd();
    console.log(`Home directory: ${homeDir}`);

    let baseDir = process.env.SFTP_REMOTE_DIR || homeDir;
    
    if (baseDir && !baseDir.startsWith('/')) {
      baseDir = `${homeDir}/${baseDir}`;
    }
    
    baseDir = baseDir.replace(/\/+/g, '/').replace(/\/$/, '');
    console.log(`Base directory: ${baseDir}`);

    const baseDirExists = await sftp.exists(baseDir);
    if (!baseDirExists) {
      console.log(`Base dir doesn't exist, trying to create: ${baseDir}`);
      await ensureDirectory(sftp, baseDir);
    }

    const folderPath = `${baseDir}/${folder}`;
    console.log(`Target folder path: ${folderPath}`);
    
    await ensureDirectory(sftp, folderPath);
    const remotePath = `${folderPath}/${filename}`;
    console.log(`Uploading to: ${remotePath} (${raw.length} bytes)`);
    await sftp.put(raw, remotePath);
    console.log(`✅ Upload successful`);

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
