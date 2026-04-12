import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET!;

/**
 * Generate a presigned URL for uploading an encrypted blob.
 * Client uploads directly to R2 — the server never touches the ciphertext.
 */
export async function getUploadUrl(storageKey: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: "application/octet-stream",
  });

  return getSignedUrl(r2, command, { expiresIn: 600 }); // 10 minutes
}

/**
 * Generate a presigned URL for downloading an encrypted blob.
 */
export async function getDownloadUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
  });

  return getSignedUrl(r2, command, { expiresIn: 600 }); // 10 minutes
}

/**
 * Delete an encrypted blob from R2.
 */
export async function deleteBlob(storageKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
  });

  await r2.send(command);
}
