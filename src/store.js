import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    if (!existsSync(this.filePath)) return {};
    const raw = readFileSync(this.filePath, "utf-8").trim();
    return raw ? JSON.parse(raw) : {};
  }

  get(key, fallback) {
    return this.data[key] ?? fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  _save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
