import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { generateSkillMd, type SkillTemplate } from './skill-generator.js';

export interface InstallResult {
  installed: boolean;
  paths: string[];
  errors: string[];
}

export function installToSuperClaw(template: SkillTemplate): InstallResult {
  const result: InstallResult = { installed: false, paths: [], errors: [] };

  try {
    const skillDir = join(homedir(), 'superclaw', 'skills', template.name);
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, generateSkillMd(template));
    result.paths.push(skillPath);
    result.installed = true;
  } catch (err) {
    result.errors.push(`SuperClaw install failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

export function installSkill(template: SkillTemplate): InstallResult {
  return installToSuperClaw(template);
}
