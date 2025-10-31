// server/src/controllers/upload.controller.js

/*
[PRO] Purpose: Issue presigned PUT URLs for direct-to-S3 uploads.
Context: Client sends fileName + fileType, server returns one-time PUT URL and final object key.
Edge cases: Missing params → 400; library errors → 500. Key prefix isolates per-user media.
Notes: Minimal validation; consider size/type limits at gateway or S3 bucket policy.
*/
import { getPresignedPutUrl } from "../lib/s3.js";

export async function getUploadUrl(req, res) {
  const { fileName, fileType } = req.query;
  if (!fileName || !fileType) {
    return res.status(400).json({ message: "fileName and fileType are required" });
  }

  const keyPrefix = `media/${req.user._id}/`;
  const safeName = String(fileName).replace(/[^\w.\-() ]/g, "_").slice(0, 180);
  const { url, key } = await getPresignedPutUrl(keyPrefix + safeName, fileType);
  res.json({ url, key });
}
