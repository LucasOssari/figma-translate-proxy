import SftpClient from "ssh2-sftp-client";
import JSZip from "jszip";

export const config = {
  api: {
    bodyParser: false
  }
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Folder");
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
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
      return res
        .status(500)
        .json({ error: "SFTP env missing (SFTP_HOST/SFTP_USER/SFTP_PASS)" });
    }

    const folderFromQuery = typeof req.query?.folder === "string" ? req.query.folder : "";
    const folderFromHeader = String(req.headers["x-folder"] || "");
    let folderName = (folderFromQuery || folderFromHeader || "ENCARTS").trim();
    if (!folderName) folderName = "ENCARTS";

    folderName = folderName.replace(/[\\\/:*?"<>|]+/g, "-").trim();
    const remotePath = `${remoteDir}/${folderName}.zip`;

    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    const raw = await readRawBody(req);

    let zipBuffer;


    if (contentType.includes("application/octet-stream")) {
      zipBuffer = raw;
    } else {

      let payload = {};
      try {
        payload = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        payload = {};
      }

      const files = Array.isArray(payload.files) ? payload.files : [];

      if (!files.length) {
        return res.status(400).json({
          error: "Bad Request: no files provided. Expected { files: [{ name, bytes:number[] }] }"
        });
      }

      const zip = new JSZip();
      const folder = zip.folder(folderName) || zip;

      for (const f of files) {
        const name = String(f?.name || "file.bin").replace(/[\\\/:*?"<>|]+/g, "-").trim();
        const bytes = Array.isArray(f?.bytes) ? f.bytes : null;
        if (!bytes) continue;

        folder.file(name, Buffer.from(Uint8Array.from(bytes)));
      }

      zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    }
    const sftp = new SftpClient();
    await sftp.connect({ host, port, username, password });

    try {
      await sftp.mkdir(remoteDir, true);
    } catch (_) {
  
    }

    await sftp.put(zipBuffer, remotePath);
    await sftp.end();

    return res.status(200).json({
      ok: true,
      remotePath,
      bytes: zipBuffer.length,
      mode: contentType.includes("application/octet-stream") ? "raw-zip" : "json->zip"
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
