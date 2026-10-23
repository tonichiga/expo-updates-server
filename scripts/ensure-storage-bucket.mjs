import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({
  endpoint: "http://minio:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER,
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
  },
});
const Bucket = process.env.OTA_STORAGE_BUCKET;
if (!Bucket) throw new Error("OTA_STORAGE_BUCKET is required.");

try {
  try {
    await client.send(new CreateBucketCommand({ Bucket }));
  } catch (error) {
    if (error.name !== "BucketAlreadyOwnedByYou") throw error;
  }
  await client.send(new HeadBucketCommand({ Bucket }));
  console.log("Storage bucket ready.");
} finally {
  client.destroy();
}
