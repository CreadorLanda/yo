import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Where a bot keeps its keys and sessions. They are secrets: losing them
 * makes every conversation unreadable, leaking them lets someone read it.
 * Keep the file out of version control and off shared disks.
 */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Keeps everything in memory. For tests; a restart loses every session. */
export class MemoryStore implements Store {
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/**
 * A JSON file, written atomically (temp file + rename) so a crash mid-write
 * never leaves a half-written key store behind.
 */
export class FileStore implements Store {
  private data: Record<string, unknown> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async load(): Promise<Record<string, unknown>> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.data = {};
    }
    return this.data;
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.path);
    });
    return this.writing;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const d = await this.load();
    return d[key] === undefined ? undefined : (structuredClone(d[key]) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    const d = await this.load();
    d[key] = structuredClone(value);
    await this.flush();
  }
  async delete(key: string): Promise<void> {
    const d = await this.load();
    delete d[key];
    await this.flush();
  }
}
