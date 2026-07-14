import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".share-together.json");

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveConfig(config) {
  await mkdir(join(CONFIG_PATH, ".."), { recursive: true }).catch(() => {});
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function getSession(config) {
  return config?.session?.token || null;
}

export function getBaseUrl(config) {
  return config?.base_url || null;
}

export async function setSession(session) {
  const config = await loadConfig();
  config.session = session;
  await saveConfig(config);
}

export async function clearSession() {
  const config = await loadConfig();
  delete config.session;
  await saveConfig(config);
}

export async function setBaseUrl(url) {
  const config = await loadConfig();
  config.base_url = url;
  await saveConfig(config);
}
