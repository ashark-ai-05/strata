/**
 * Config file loader.
 *
 * Resolution order:
 *   1. $STRATA_CONFIG env var (absolute path)
 *   2. ~/.strata/config.json
 *
 * If the file doesn't exist, writes a default config and returns it.
 * Throws a descriptive error if the file exists but fails Zod validation.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { ZodError } from 'zod';
import {
  ConfigFileSchema,
  ProfileSchema,
  DEFAULT_CONFIG,
  type Profile,
  type ConfigFile,
} from './schema.js';

export type LoadedConfig = {
  activeProfile: Profile;
  allProfiles: Profile[];
  configPath: string;
};

function defaultConfigPath(): string {
  return join(homedir(), '.strata', 'config.json');
}

function resolveConfigPath(): string {
  return process.env['STRATA_CONFIG'] ?? defaultConfigPath();
}

function writeDefaultConfig(configPath: string): ConfigFile {
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf-8');
  console.error(`strata: wrote default config to ${configPath}`);
  return DEFAULT_CONFIG;
}

function parseConfig(raw: string, configPath: string): ConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`strata: config at ${configPath} is not valid JSON`);
  }
  try {
    return ConfigFileSchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`strata: config validation failed at ${configPath}:\n${issues}`);
    }
    throw err;
  }
}

/**
 * Load the config file.
 *
 * @param profileOverride - if provided, selects this profile name instead of activeProfile
 */
export function loadConfig(profileOverride?: string): LoadedConfig {
  const configPath = resolveConfigPath();

  let config: ConfigFile;
  if (!existsSync(configPath)) {
    config = writeDefaultConfig(configPath);
  } else {
    const raw = readFileSync(configPath, 'utf-8');
    config = parseConfig(raw, configPath);
  }

  const targetName = profileOverride ?? config.activeProfile;
  const activeProfile = config.profiles.find((p) => p.name === targetName);

  if (!activeProfile) {
    const names = config.profiles.map((p) => p.name).join(', ');
    throw new Error(
      `strata: profile "${targetName}" not found in config. Available: ${names}`,
    );
  }

  return {
    activeProfile: ProfileSchema.parse(activeProfile),
    allProfiles: config.profiles,
    configPath,
  };
}
