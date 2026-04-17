import { z } from 'zod';

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  allowFrom: z.array(z.string()).default([]),
  defaultChatId: z.string().optional().default(''),
  pollingIntervalMs: z.number().default(1000),
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().default(30),
  collectors: z.array(z.string()).default(['system', 'dev', 'process']),
  alerting: z.object({
    cpuThreshold: z.number().default(90),
    memoryThreshold: z.number().default(85),
    diskThreshold: z.number().default(90),
  }).default({}),
});

export const MemoryConfigSchema = z.object({
  dbPath: z.string().default('data/memory.db'),
});

export const ObsidianConfigSchema = z.object({
  vaultPath: z.string().optional(),
  autoSync: z.boolean().default(false),
  syncOn: z.array(z.string()).default(['session_end']),
  include: z.array(z.string()).default(['knowledge', 'learnings']),
});

export const WatcherConfigSchema = z.object({
  enabled: z.boolean().default(true),
  idleMinutes: z.number().default(60),
  pollIntervalSeconds: z.number().default(60),
  maxRetries: z.number().default(3),
  batchSize: z.number().default(1),
  extractionTimeoutMs: z.number().default(600_000),
});

export const SuperClawConfigSchema = z.object({
  telegram: TelegramConfigSchema.default({}),
  heartbeat: HeartbeatConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  peekaboo: z.object({
    path: z.string().default('/opt/homebrew/bin/peekaboo'),
  }).default({}),
  obsidian: ObsidianConfigSchema.default({}),
  watcher: WatcherConfigSchema.default({}),
});

export type SuperClawConfig = z.infer<typeof SuperClawConfigSchema>;
