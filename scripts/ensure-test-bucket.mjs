import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({
  endpoint: "http://minio:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER,
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
  },
});

try {
  await client.send(new CreateBucketCommand({ Bucket: process.env.OTA_STORAGE_BUCKET }));
  console.log("Test storage bucket ready.");
} catch (error) {
  if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)) throw error;
  console.log("Test storage bucket already exists.");
} finally {
  client.destroy();
}
