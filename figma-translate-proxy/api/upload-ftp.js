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
  setCors(res);
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const host = process.env.SFTP_HOST;
    const port = Number(process.env.SFTP_PORT || 22);
    const username = process.env.SFTP_USER;
    const password = process.env.SFTP_PASS;
    const remoteDir = process.env.SFTP_REMOTE_DIR || "/uploads";

    if (!host || !username || !password) {
      return res.status(500).json({
        error: "SFTP credentials not configured"
      });
    }

    const folder = sanitizeName(
      typeof req.query?.folder === "string" ? req.query.folder : "ENCARTS"
    );
    const filename = sanitizeName(
      typeof req.query?.name === "string" ? req.query.name : ""
    );

    if (!filename) {
      return res.status(400).json({ error: "Missing ?name=filename" });
    }

    const raw = await readRawBody(req);

    const folderPath = `${remoteDir}/${folder}`;
    const remotePath = `${folderPath}/${filename}`;

    const sftp = new SftpClient();
    await sftp.connect({ host, port, username, password });

    try {
      await sftp.mkdir(folderPath, true);
    } catch (e) {
      // Directory exists
    }

    await sftp.put(raw, remotePath);
    await sftp.end();

    return res.status(200).json({
      ok: true,
      remotePath,
      bytes: raw.length
    });

  } catch (e) {
    console.error("FTP error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
