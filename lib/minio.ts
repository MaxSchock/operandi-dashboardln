import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * MinIO (S3-compatible) client for video references and deliverables.
 * Bucket layout:
 *   refs/{client_slug}/{request_id}/...   client uploads (kept)
 *   scratch/{request_id}/...              render intermediates (30-day lifecycle)
 *   deliverables/{request_id}/v{n}.mp4    final videos (kept)
 *   storyboards/{request_id}/...
 */
const BUCKET = process.env.MINIO_BUCKET || "operandi-video";

function client() {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT || "https://sss3.figura-studio.com",
    region: process.env.MINIO_REGION || "eu-south",
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY!,
      secretAccessKey: process.env.MINIO_SECRET_KEY!,
    },
    forcePathStyle: true,
  });
}

export async function presignPut(key: string, mime: string, expiresSeconds = 900) {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: mime }), {
    expiresIn: expiresSeconds,
  });
}

export async function presignGet(key: string, expiresSeconds = 3600) {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: expiresSeconds,
  });
}

export async function headObject(key: string) {
  try {
    const r = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { exists: true, size: r.ContentLength ?? 0, mime: r.ContentType ?? null };
  } catch {
    return { exists: false, size: 0, mime: null };
  }
}
