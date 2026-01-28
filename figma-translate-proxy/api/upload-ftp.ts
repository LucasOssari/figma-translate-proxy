import type { VercelRequest, VercelResponse } from '@vercel/node';
import SftpClient from 'ssh2-sftp-client';

export const config = {
  api: { 
    bodyParser: false,
    responseLimit: '10mb'
  }
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sanitizeName(s: string | string[] | undefined): string {
  return String(s || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ✅ CORS HEADERS - TOUJOURS EN PREMIER
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  
  // ✅ Handle OPTIONS
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
      return res.status(500).json({ error: "SFTP credentials not configured" });
    }

    const folder = sanitizeName(req.query.folder);
    const filename = sanitizeName(req.query.name);

    if (!filename) {
      return res.status(400).json({ error: "Missing filename parameter" });
    }

    const raw = await readRawBody(req);
    
    if (raw.length === 0) {
      return res.status(400).json({ error: "Empty file content" });
    }

    console.log(`Connecting to SFTP: ${SFTP_HOST}:${port}`);

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

    console.log(`Creating directory: ${folderPath}`);
    
    try {
      const exists = await sftp.exists(folderPath);
      if (!exists) {
        await sftp.mkdir(folderPath, true);
      }
    } catch (e: any) {
      console.log(`Directory creation info: ${e.message}`);
    }

    console.log(`Uploading to: ${remotePath} (${raw.length} bytes)`);
    await sftp.put(raw, remotePath);

    return res.status(200).json({
      ok: true,
      remotePath,
      bytes: raw.length
    });

  } catch (e: any) {
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
