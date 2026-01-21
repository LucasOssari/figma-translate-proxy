import SftpClient from "ssh2-sftp-client";

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Folder");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const folderName = String(req.headers["x-folder"] || "ENCARTS");
    const remoteDir = process.env.SFTP_REMOTE_DIR || "/uploads";
    const remotePath = `${remoteDir}/${folderName}.zip`;

    const host = process.env.SFTP_HOST;
    const port = Number(process.env.SFTP_PORT || 22);
    const username = process.env.SFTP_USER;
    const password = process.env.SFTP_PASS; 

    if (!host || !username || !password) {
      return res.status(500).json({ error: "SFTP env missing (SFTP_HOST/SFTP_USER/SFTP_PASS)" });
    }

    // récupérer le body binaire
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buffer = Buffer.concat(chunks);

    const sftp = new SftpClient();
    await sftp.connect({ host, port, username, password });


    await sftp.put(buffer, remotePath);
    await sftp.end();

    return res.status(200).json({ ok: true, remotePath, bytes: buffer.length });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
