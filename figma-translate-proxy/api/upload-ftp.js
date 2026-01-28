import { Client } from 'ssh2';
import { promisify } from 'util';

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

function sftpUpload(host, port, username, password, localBuffer, remotePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        const writeStream = sftp.createWriteStream(remotePath);
        
        writeStream.on('close', () => {
          conn.end();
          resolve();
        });
        
        writeStream.on('error', (err) => {
          conn.end();
          reject(err);
        });

        writeStream.write(localBuffer);
        writeStream.end();
      });
    });

    conn.on('error', reject);

    conn.connect({
      host,
      port,
      username,
      password,
      readyTimeout: 20000
    });
  });
}

async function ensureDir(host, port, username, password, dirPath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        sftp.mkdir(dirPath, { mode: 0o755 }, (mkdirErr) => {
          conn.end();
          // Ignore error if directory exists
          resolve();
        });
      });
    });

    conn.on('error', reject);

    conn.connect({ host, port, username, password });
  });
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

  try {
    const { SFTP_HOST, SFTP_USER, SFTP_PASS } = process.env;
    const port = Number(process.env.SFTP_PORT || 22);
    const remoteDir = process.env.SFTP_REMOTE_DIR || "/uploads";

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

    const folderPath = `${remoteDir}/${folder}`;
    const remotePath = `${folderPath}/${filename}`;

    console.log(`Creating directory: ${folderPath}`);
    
    try {
      await ensureDir(SFTP_HOST, port, SFTP_USER, SFTP_PASS, folderPath);
    } catch (e) {
      console.log(`Directory creation info: ${e.message}`);
    }

    console.log(`Uploading to: ${remotePath} (${raw.length} bytes)`);
    
    await sftpUpload(SFTP_HOST, port, SFTP_USER, SFTP_PASS, raw, remotePath);

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
  }
}
