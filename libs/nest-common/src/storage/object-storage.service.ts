import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DocumentTicket } from '@ssm/contracts';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/app-config.js';
import { SecretsService } from '../secrets/secrets.service.js';

/**
 * Cloudflare R2 via the S3 API.
 *
 * Documents never pass through the services. The browser uploads straight to R2
 * with a presigned PUT and downloads with a presigned GET — the API only ever
 * issues short-lived tickets. That keeps large binaries off the Node event loop
 * and out of the pod's memory, and it means a leaked API response grants at most
 * a few minutes of access to a single object.
 *
 * Locally, when the R2 credential files are empty, this points at the MinIO
 * container from docker-compose so the same code path is exercised.
 */
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly log = new Logger(ObjectStorageService.name);
  private client!: S3Client;
  private bucket!: string;

  constructor(
    private readonly cfg: AppConfig,
    private readonly secrets: SecretsService,
  ) {}

  onModuleInit(): void {
    const accountId = this.secrets.get('r2_account_id');
    const accessKeyId = this.secrets.get('r2_access_key_id');
    const secretAccessKey = this.secrets.get('r2_secret_access_key');

    this.bucket = this.cfg.R2_BUCKET;

    const endpoint =
      this.cfg.R2_ENDPOINT ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : 'http://minio:9000');

    if (!accessKeyId || !secretAccessKey) {
      this.log.warn(
        'R2 credentials are empty — falling back to the local MinIO credentials. ' +
          'Fill secrets/local/r2_* before pointing at a real bucket.',
      );
    }

    this.client = new S3Client({
      region: this.cfg.R2_REGION,
      endpoint,
      // R2 and MinIO both need path-style addressing.
      forcePathStyle: true,
      credentials: {
        accessKeyId: accessKeyId ?? 'ssm-local',
        secretAccessKey: secretAccessKey ?? this.secrets.get('minio_password') ?? 'ssm-local-secret',
      },
    });

    this.log.log(`Object storage: ${endpoint} bucket=${this.bucket}`);
  }

  /**
   * Builds an object key. Tenant first so a bucket policy or lifecycle rule can
   * be scoped by prefix, and so listing one tenant never touches another's keys.
   */
  buildKey(tenantId: string, module: string, aggregateId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    return `${tenantId}/${module}/${aggregateId}/${randomUUID()}-${safe}`;
  }

  /** Presigned PUT the browser uploads to directly. */
  async uploadTicket(
    key: string,
    contentType: string,
    ttlSeconds = 300,
  ): Promise<DocumentTicket> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      key,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** Presigned GET. Short TTL — these end up in browser history and referrers. */
  async downloadTicket(key: string, ttlSeconds = 120): Promise<DocumentTicket> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      key,
      method: 'GET',
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** Server-side upload, for documents the service itself renders (invoice PDFs). */
  async put(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
