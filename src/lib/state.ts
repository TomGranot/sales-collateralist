import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { PersistentState, ThreadState } from "../types.js";

const EMPTY_STATE: PersistentState = {
  bootstrap: {},
  threads: {},
};

export class StateStore {
  async read(): Promise<PersistentState> {
    try {
      const raw = await fs.readFile(config.stateFile, "utf8");
      return JSON.parse(raw) as PersistentState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return structuredClone(EMPTY_STATE);
      }
      throw error;
    }
  }

  async write(state: PersistentState): Promise<void> {
    await fs.mkdir(path.dirname(config.stateFile), { recursive: true });
    const tempPath = `${config.stateFile}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2));
    await fs.rename(tempPath, config.stateFile);
  }

  async update(mutator: (state: PersistentState) => void): Promise<PersistentState> {
    const state = await this.read();
    mutator(state);
    await this.write(state);
    return state;
  }

  async getThread(threadKey: string): Promise<ThreadState | undefined> {
    const state = await this.read();
    return state.threads[threadKey];
  }
}

export const stateStore = new StateStore();
