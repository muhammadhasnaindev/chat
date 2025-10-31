// server/src/lib/s3.js
/*
[PRO] Purpose: Generate presigned PUT URLs so the client can upload directly to S3.
Context: Offloads file transfer from the API server; caller passes object key and MIME type.
Edge cases: Missing AWS env or bucket → throws; URL expires quickly to reduce abuse; key sanitized by caller.
Notes: Signature v4; keep Expires short. Consider bucket policy to restrict content types/sizes.
*/
import AWS from "aws-sdk";
import { env } from "../config/env.js";

const s3 = new AWS.S3({
  accessKeyId: env.AWS.ACCESS_KEY_ID,
  secretAccessKey: env.AWS.SECRET_ACCESS_KEY,
  region: env.AWS.REGION,
  signatureVersion: "v4",
});

export async function getPresignedPutUrl(Key, ContentType) {
  if (!env.AWS.S3_BUCKET) throw new Error("S3 bucket not configured");
  const params = {
    Bucket: env.AWS.S3_BUCKET,
    Key,
    ContentType,
    Expires: 60,
  };
  const url = await s3.getSignedUrlPromise("putObject", params);
  return { url, key: Key };
}
