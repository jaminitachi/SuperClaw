import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface SkillTemplate {
  name: string;
  description: string;
  purpose: string;
  triggers: string[];
  steps: string[];
  tools: string[];
}

export function generateSkillMd(template: SkillTemplate): string {
  return `---
name: ${template.name}
description: ${template.description}
---

<Purpose>
${template.purpose}
</Purpose>

<Use_When>
${template.triggers.map((t) => `- ${t}`).join('\n')}
</Use_When>

<Do_Not_Use_When>
- Task is already covered by an existing skill
- One-off operation that won't recur
</Do_Not_Use_When>

<Steps>
${template.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
</Steps>

<Tool_Usage>
${template.tools.map((t) => `- ${t}`).join('\n')}
</Tool_Usage>

<Final_Checklist>
- [ ] Action completed successfully
- [ ] Result verified
- [ ] User informed
</Final_Checklist>
`;
}

export function installSkill(skillDir: string, template: SkillTemplate): string {
  const dir = join(skillDir, template.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, generateSkillMd(template));
  return path;
}
