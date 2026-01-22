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

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const host = process.env.SFTP_HOST;
    const port = Number(process.env.SFTP_PORT || 22);
    const username = process.env.SFTP_USER;
    const password = process.env.SFTP_PASS;
    const remoteDir = process.env.SFTP_REMOTE_DIR || "/uploads";

    if (!host || !username || !password) {
      return res.status(500).json({
        error: "SFTP env missing (SFTP_HOST/SFTP_USER/SFTP_PASS)"
      });
    }

    const folder = sanitizeName(typeof req.query?.folder === "string" ? req.query.folder : "ENCARTS");
    const filename = sanitizeName(typeof req.query?.name === "string" ? req.query.name : "");

    if (!filename) {
      return res.status(400).json({ error: "Missing ?name=filename" });
    }

    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    const raw = await readRawBody(req);

    let fileBuffer;

    // Option A: binaire direct (application/octet-stream)
    if (contentType.includes("application/octet-stream")) {
      fileBuffer = raw;
    } else {
      // Option B: JSON / text/plain { bytes: number[] }
      let payload = {};
      try {
        payload = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        payload = {};
      }

      const bytes = Array.isArray(payload?.bytes) ? payload.bytes : null;
      if (!bytes || !bytes.length) {
        return res.status(400).json({
          error: "Bad Request: expected { bytes: number[] }"
        });
      }

      fileBuffer = Buffer.from(Uint8Array.from(bytes));
    }

    const folderPath = `${remoteDir}/${folder}`;
    const remotePath = `${folderPath}/${filename}`;

    const sftp = new SftpClient();
    await sftp.connect({ host, port, username, password });

    try {
      await sftp.mkdir(folderPath, true);
    } catch (_) {
      // ignore
    }

    await sftp.put(fileBuffer, remotePath);
    await sftp.end();

    return res.status(200).json({
      ok: true,
      remotePath,
      bytes: fileBuffer.length
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
