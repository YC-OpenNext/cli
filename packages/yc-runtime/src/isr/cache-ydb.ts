import {
  Driver,
  getSACredentialsFromJson,
  IamAuthService,
  StaticCredentialsAuthService,
  MetadataAuthService,
  Session,
  TableDescription,
  Column,
  Types,
  TypedValues,
} from 'ydb-sdk';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import crypto from 'crypto';

export interface ISRCacheOptions {
  region?: string;
  s3Endpoint?: string;
  ydbEndpoint: string;
  ydbDatabase: string;
  cacheBucket: string;
  tablesPrefix?: string;
  buildId: string;
  // YDB auth credentials
  ydbAccessKeyId?: string;
  ydbSecretAccessKey?: string;
  ydbServiceAccountJson?: string;
}

export interface CacheEntry {
  key: string;
  value: string | Buffer;
  metadata?: {
    headers?: Record<string, string>;
    status?: number;
    tags?: string[];
    revalidateAfter?: number;
  };
}

export class ISRCache {
  private s3Client: S3Client;
  private ydbDriver: Driver | null = null;
  private cacheBucket: string;
  private buildId: string;
  private tablesPrefix: string;
  private ydbEndpoint: string;
  private ydbDatabase: string;
  private ydbCredentials: any;

  constructor(options: ISRCacheOptions) {
    const {
      region = 'ru-central1',
      s3Endpoint = 'https://storage.yandexcloud.net',
      ydbEndpoint,
      ydbDatabase,
      cacheBucket,
      tablesPrefix = 'isr',
      buildId,
      ydbAccessKeyId,
      ydbSecretAccessKey,
      ydbServiceAccountJson,
    } = options;

    this.cacheBucket = cacheBucket;
    this.buildId = buildId;
    this.tablesPrefix = tablesPrefix;
    this.ydbEndpoint = ydbEndpoint;
    this.ydbDatabase = ydbDatabase;

    // Initialize S3 client for cache storage
    this.s3Client = new S3Client({
      region,
      endpoint: s3Endpoint,
    });

    // Store YDB credentials for initialization
    if (ydbServiceAccountJson) {
      this.ydbCredentials = { type: 'service-account', json: ydbServiceAccountJson };
    } else if (ydbAccessKeyId && ydbSecretAccessKey) {
      this.ydbCredentials = {
        type: 'access-key',
        accessKeyId: ydbAccessKeyId,
        secretAccessKey: ydbSecretAccessKey,
      };
    }
  }

  /**
   * Initialize YDB connection and create tables if needed
   */
  private async initYDB(): Promise<void> {
    if (this.ydbDriver) return;

    // Create auth service based on credentials type
    let authService: IamAuthService | StaticCredentialsAuthService | MetadataAuthService;
    if (this.ydbCredentials?.type === 'service-account') {
      authService = new IamAuthService(getSACredentialsFromJson(this.ydbCredentials.json));
    } else if (this.ydbCredentials?.type === 'access-key') {
      // Use static credentials
      authService = new StaticCredentialsAuthService(
        this.ydbCredentials.accessKeyId,
        this.ydbCredentials.secretAccessKey,
        'iam.api.cloud.yandex.net:443',
      );
    } else {
      // Use metadata service (for functions running in Yandex Cloud)
      authService = new MetadataAuthService();
    }

    this.ydbDriver = new Driver({
      endpoint: this.ydbEndpoint,
      database: this.ydbDatabase,
      authService,
    });

    const timeout = 10000;
    if (!(await this.ydbDriver.ready(timeout))) {
      throw new Error(`YDB driver failed to become ready in ${timeout}ms`);
    }

    // Create tables if they don't exist
    await this.createTablesIfNeeded();
  }

  /**
   * Create ISR tables if they don't exist
   */
  private async createTablesIfNeeded(): Promise<void> {
    if (!this.ydbDriver) throw new Error('YDB driver not initialized');

    await this.ydbDriver.tableClient.withSession(async (session: Session) => {
      // Create entries table
      const entriesTable = `${this.tablesPrefix}_entries`;
      try {
        await session.createTable(
          entriesTable,
          new TableDescription()
            .withColumns(
              new Column('pk', Types.UTF8),
              new Column('sk', Types.UTF8),
              new Column('value', Types.JSON),
              new Column('ttl', Types.UINT64),
              new Column('tags', Types.JSON),
              new Column('lastModified', Types.UINT64),
              new Column('revalidateAfter', Types.UINT64),
            )
            .withPrimaryKeys('pk', 'sk'),
        );
        console.log(`Created table: ${entriesTable}`);
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          console.error(`Failed to create table ${entriesTable}:`, err);
        }
      }

      // Create tags table
      const tagsTable = `${this.tablesPrefix}_tags`;
      try {
        await session.createTable(
          tagsTable,
          new TableDescription()
            .withColumns(
              new Column('tag', Types.UTF8),
              new Column('pk', Types.UTF8),
              new Column('sk', Types.UTF8),
              new Column('ttl', Types.UINT64),
            )
            .withPrimaryKeys('tag', 'pk', 'sk'),
        );
        console.log(`Created table: ${tagsTable}`);
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          console.error(`Failed to create table ${tagsTable}:`, err);
        }
      }

      // Create locks table
      const locksTable = `${this.tablesPrefix}_locks`;
      try {
        await session.createTable(
          locksTable,
          new TableDescription()
            .withColumns(
              new Column('pk', Types.UTF8),
              new Column('locked', Types.BOOL),
              new Column('lockedAt', Types.UINT64),
              new Column('ttl', Types.UINT64),
            )
            .withPrimaryKeys('pk'),
        );
        console.log(`Created table: ${locksTable}`);
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          console.error(`Failed to create table ${locksTable}:`, err);
        }
      }
    });
  }

  /**
   * Get cache entry
   */
  async get(key: string): Promise<CacheEntry | null> {
    console.log('[ISR] Getting cache entry:', key);

    try {
      await this.initYDB();

      // Get metadata from YDB
      const metadata = await this.getMetadataFromYDB(key);
      if (!metadata) {
        console.log('[ISR] Cache miss for:', key);
        return null;
      }

      // Get data from S3 if it has a body
      let value: string | Buffer = '';
      if (metadata.hasBody) {
        const s3Key = this.getS3Key(key);
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.cacheBucket,
            Key: s3Key,
          }),
        );

        if (response.Body) {
          const stream = response.Body as Readable;
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          value = Buffer.concat(chunks);
        }
      }

      return {
        key,
        value,
        metadata: {
          headers: metadata.headers,
          status: metadata.status,
          tags: metadata.tags,
          revalidateAfter: metadata.revalidateAfter,
        },
      };
    } catch (error) {
      console.error('[ISR] Error getting cache entry:', error);
      return null;
    }
  }

  /**
   * Get metadata from YDB
   */
  private async getMetadataFromYDB(key: string): Promise<any | null> {
    if (!this.ydbDriver) throw new Error('YDB driver not initialized');

    return await this.ydbDriver.tableClient.withSession(async (session: Session) => {
      const query = `
        DECLARE $pk AS Utf8;
        DECLARE $sk AS Utf8;

        SELECT value, tags, lastModified, revalidateAfter
        FROM \`${this.tablesPrefix}_entries\`
        WHERE pk = $pk AND sk = $sk;
      `;

      const preparedQuery = await session.prepareQuery(query);
      const result = await session.executeQuery(preparedQuery, {
        $pk: TypedValues.utf8(this.getCacheKey(key)),
        $sk: TypedValues.utf8('metadata'),
      });

      const resultSet = result.resultSets[0];
      if (resultSet && resultSet.rows && resultSet.rows.length > 0) {
        const row = resultSet.rows[0] as any;
        return JSON.parse(row.value);
      }

      return null;
    });
  }

  /**
   * Set cache entry
   */
  async set(
    key: string,
    entry: CacheEntry,
    options?: { tags?: string[]; revalidate?: number },
  ): Promise<void> {
    console.log('[ISR] Setting cache entry:', key);

    try {
      await this.initYDB();

      const now = Date.now();
      const ttl = options?.revalidate
        ? Math.floor(now / 1000) + options.revalidate
        : Math.floor(now / 1000) + 31536000; // 1 year default

      // Store metadata in YDB
      const metadata = {
        hasBody: !!entry.value,
        headers: entry.metadata?.headers || {},
        status: entry.metadata?.status || 200,
        tags: options?.tags || entry.metadata?.tags || [],
        revalidateAfter: entry.metadata?.revalidateAfter || now + (options?.revalidate || 0) * 1000,
        lastModified: now,
      };

      await this.setMetadataInYDB(key, metadata, ttl);

      // Store tags mapping
      if (metadata.tags.length > 0) {
        await this.setTagsInYDB(key, metadata.tags, ttl);
      }

      // Store body in S3 if present
      if (entry.value) {
        const s3Key = this.getS3Key(key);
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.cacheBucket,
            Key: s3Key,
            Body: entry.value,
            ContentType: 'application/octet-stream',
            Metadata: {
              'x-cache-key': key,
              'x-build-id': this.buildId,
            },
          }),
        );
      }

      console.log('[ISR] Cache entry set successfully');
    } catch (error) {
      console.error('[ISR] Error setting cache entry:', error);
      throw error;
    }
  }

  /**
   * Set metadata in YDB
   */
  private async setMetadataInYDB(key: string, metadata: any, ttl: number): Promise<void> {
    if (!this.ydbDriver) throw new Error('YDB driver not initialized');

    await this.ydbDriver.tableClient.withSession(async (session: Session) => {
      const query = `
        DECLARE $pk AS Utf8;
        DECLARE $sk AS Utf8;
        DECLARE $value AS Json;
        DECLARE $ttl AS Uint64;
        DECLARE $tags AS Json;
        DECLARE $lastModified AS Uint64;
        DECLARE $revalidateAfter AS Uint64;

        UPSERT INTO \`${this.tablesPrefix}_entries\`
        (pk, sk, value, ttl, tags, lastModified, revalidateAfter)
        VALUES ($pk, $sk, $value, $ttl, $tags, $lastModified, $revalidateAfter);
      `;

      const preparedQuery = await session.prepareQuery(query);
      await session.executeQuery(preparedQuery, {
        $pk: TypedValues.utf8(this.getCacheKey(key)),
        $sk: TypedValues.utf8('metadata'),
        $value: TypedValues.json(JSON.stringify(metadata)),
        $ttl: TypedValues.uint64(ttl),
        $tags: TypedValues.json(JSON.stringify(metadata.tags)),
        $lastModified: TypedValues.uint64(metadata.lastModified),
        $revalidateAfter: TypedValues.uint64(metadata.revalidateAfter),
      });
    });
  }

  /**
   * Set tags in YDB
   */
  private async setTagsInYDB(key: string, tags: string[], ttl: number): Promise<void> {
    if (!this.ydbDriver) throw new Error('YDB driver not initialized');

    await this.ydbDriver.tableClient.withSession(async (session: Session) => {
      for (const tag of tags) {
        const query = `
          DECLARE $tag AS Utf8;
          DECLARE $pk AS Utf8;
          DECLARE $sk AS Utf8;
          DECLARE $ttl AS Uint64;

          UPSERT INTO \`${this.tablesPrefix}_tags\`
          (tag, pk, sk, ttl)
          VALUES ($tag, $pk, $sk, $ttl);
        `;

        const preparedQuery = await session.prepareQuery(query);
        await session.executeQuery(preparedQuery, {
          $tag: TypedValues.utf8(tag),
          $pk: TypedValues.utf8(this.getCacheKey(key)),
          $sk: TypedValues.utf8('metadata'),
          $ttl: TypedValues.uint64(ttl),
        });
      }
    });
  }

  /**
   * Delete cache entry
   */
  async delete(key: string): Promise<void> {
    console.log('[ISR] Deleting cache entry:', key);

    try {
      await this.initYDB();

      // Delete from YDB
      await this.deleteFromYDB(key);

      // Delete from S3
      const s3Key = this.getS3Key(key);
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.cacheBucket,
          Key: s3Key,
        }),
      );

      console.log('[ISR] Cache entry deleted successfully');
    } catch (error) {
      console.error('[ISR] Error deleting cache entry:', error);
      throw error;
    }
  }

  /**
   * Delete from YDB
   */
  private async deleteFromYDB(key: string): Promise<void> {
    if (!this.ydbDriver) throw new Error('YDB driver not initialized');

    await this.ydbDriver.tableClient.withSession(async (session: Session) => {
      // Delete from entries table
      const deleteEntryQuery = `
        DECLARE $pk AS Utf8;
        DECLARE $sk AS Utf8;

        DELETE FROM \`${this.tablesPrefix}_entries\`
        WHERE pk = $pk AND sk = $sk;
      `;

      const preparedEntryQuery = await session.prepareQuery(deleteEntryQuery);
      await session.executeQuery(preparedEntryQuery, {
        $pk: TypedValues.utf8(this.getCacheKey(key)),
        $sk: TypedValues.utf8('metadata'),
      });

      // Delete from tags table
      const deleteTagsQuery = `
        DECLARE $pk AS Utf8;
        DECLARE $sk AS Utf8;

        DELETE FROM \`${this.tablesPrefix}_tags\`
        WHERE pk = $pk AND sk = $sk;
      `;

      const preparedTagsQuery = await session.prepareQuery(deleteTagsQuery);
      await session.executeQuery(preparedTagsQuery, {
        $pk: TypedValues.utf8(this.getCacheKey(key)),
        $sk: TypedValues.utf8('metadata'),
      });
    });
  }

  /**
   * Revalidate entries by tag
   */
  async revalidateTag(tag: string): Promise<void> {
    console.log('[ISR] Revalidating entries with tag:', tag);

    try {
      await this.initYDB();

      if (!this.ydbDriver) throw new Error('YDB driver not initialized');

      await this.ydbDriver.tableClient.withSession(async (session: Session) => {
        // Get all entries with the tag
        const query = `
          DECLARE $tag AS Utf8;

          SELECT pk, sk
          FROM \`${this.tablesPrefix}_tags\`
          WHERE tag = $tag;
        `;

        const preparedQuery = await session.prepareQuery(query);
        const result = await session.executeQuery(preparedQuery, {
          $tag: TypedValues.utf8(tag),
        });

        // Delete each entry
        const rows = result.resultSets[0]?.rows || [];
        for (const rowData of rows) {
          const row = rowData as any;
          const deleteQuery = `
            DECLARE $pk AS Utf8;
            DECLARE $sk AS Utf8;

            DELETE FROM \`${this.tablesPrefix}_entries\`
            WHERE pk = $pk AND sk = $sk;
          `;

          const preparedDeleteQuery = await session.prepareQuery(deleteQuery);
          await session.executeQuery(preparedDeleteQuery, {
            $pk: TypedValues.utf8(row.pk),
            $sk: TypedValues.utf8(row.sk),
          });
        }

        console.log(
          `[ISR] Revalidated ${result.resultSets[0]?.rows?.length || 0} entries with tag:`,
          tag,
        );
      });
    } catch (error) {
      console.error('[ISR] Error revalidating tag:', error);
      throw error;
    }
  }

  /**
   * Get cache key
   */
  private getCacheKey(key: string): string {
    return `${this.buildId}:${key}`;
  }

  /**
   * Get S3 key for cache entry
   */
  private getS3Key(key: string): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return `${this.tablesPrefix}/${this.buildId}/${hash.substring(0, 2)}/${hash}`;
  }

  /**
   * Close YDB connection
   */
  async close(): Promise<void> {
    if (this.ydbDriver) {
      await this.ydbDriver.destroy();
      this.ydbDriver = null;
    }
  }
}
