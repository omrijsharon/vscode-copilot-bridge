import { RelayLogEntry } from "./types";

export class RelayLogger {
  private readonly entries: RelayLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 300) {
    this.maxEntries = maxEntries;
  }

  record(entry: RelayLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  list(): RelayLogEntry[] {
    return [...this.entries];
  }
}
