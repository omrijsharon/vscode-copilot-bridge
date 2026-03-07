import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface ThreadMetadataRecord {
  title?: string;
}

interface ThreadMetadataFile {
  titles: Record<string, ThreadMetadataRecord>;
}

export class ThreadMetadataStore {
  private readonly filePath: string;
  private readonly titles = new Map<string, ThreadMetadataRecord>();

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, "thread-metadata.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ThreadMetadataFile;
      for (const [threadId, record] of Object.entries(parsed.titles ?? {})) {
        this.titles.set(threadId, record);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT")) {
        throw error;
      }
    }
  }

  get(threadId: string): ThreadMetadataRecord | undefined {
    return this.titles.get(threadId);
  }

  async setTitle(threadId: string, title: string): Promise<void> {
    this.titles.set(threadId, { title });
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: ThreadMetadataFile = {
      titles: Object.fromEntries(this.titles.entries())
    };
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}
