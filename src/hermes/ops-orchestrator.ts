import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { createLogger } from '../core/logger.js';

const log = createLogger('OpsOrchestrator');

export interface OpsSkill {
  id: string;
  triggerCondition: string;
  script: string;
  createdAt: string;
}

/**
 * Operations Orchestrator
 * Executes AI-generated server maintenance scripts safely.
 */
export class OpsOrchestrator {
  private skillsDir: string;
  private activeSkills: OpsSkill[] = [];
  private onSkillComplete?: (skill: OpsSkill, success: boolean, output: string) => void;

  constructor(opts?: { onSkillComplete?: (skill: OpsSkill, success: boolean, output: string) => void }) {
    this.onSkillComplete = opts?.onSkillComplete;
    this.skillsDir = path.join(process.cwd(), '.agents', 'skills', 'ops');
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      } else {
        this.loadSkills();
      }
    } catch (e) {
      log.warn(`[Ops] Failed to initialize skills directory: ${String(e)}`);
    }
  }

  private loadSkills() {
    const files = fs.readdirSync(this.skillsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const skill = JSON.parse(fs.readFileSync(path.join(this.skillsDir, file), 'utf8'));
        this.activeSkills.push(skill);
      } catch (e) {
        log.warn(`[Ops] Failed to load skill ${file}: ${String(e)}`);
      }
    }
    log.info(`[Ops] Loaded ${this.activeSkills.length} active autonomous OpsSkills.`);
  }

  public registerOpsSkill(script: string, triggerCondition: string = 'manual') {
    const id = `ops_skill_${Date.now()}`;
    const skill: OpsSkill = {
      id,
      triggerCondition,
      script,
      createdAt: new Date().toISOString()
    };

    try {
      fs.writeFileSync(path.join(this.skillsDir, `${id}.json`), JSON.stringify(skill, null, 2));
      this.activeSkills.push(skill);
      log.info(`[Ops] Successfully registered new OpsSkill: ${id} (Trigger: ${triggerCondition})`);
      
      // If it's an immediate trigger (e.g. high memory), run it immediately
      if (triggerCondition.includes('immediate') || triggerCondition.includes('urgent')) {
         this.executeSkill(skill);
      }
    } catch (e) {
      log.error(`[Ops] Failed to save OpsSkill: ${String(e)}`);
    }
  }

  public evaluateTriggers(metrics: { memoryUsagePct: number; zombieCount: number; proxyHealth: string }) {
    for (const skill of this.activeSkills) {
      // Basic heuristic evaluator. In a full system, this would evaluate actual expressions
      if (skill.triggerCondition.includes('memory') && metrics.memoryUsagePct > 85) {
        this.executeSkill(skill);
      } else if (skill.triggerCondition.includes('zombies') && metrics.zombieCount > 5) {
        this.executeSkill(skill);
      }
    }
  }

  private executeSkill(skill: OpsSkill) {
    log.warn(`🧨 [Ops] Executing autonomous OpsSkill: ${skill.id}`);
    
    // We execute via a spawned node process to protect the main server loop from crashing
    const tempScriptPath = path.join(this.skillsDir, `${skill.id}.run.js`);
    
    // Add basic safety wrappers
    const wrappedScript = `
      try {
        console.log("Starting OpsSkill Execution...");
        ${skill.script}
        console.log("OpsSkill execution complete.");
      } catch(e) {
        console.error("OpsSkill crashed:", e.message);
        process.exit(1);
      }
    `;

    try {
      fs.writeFileSync(tempScriptPath, wrappedScript);
      exec(`node ${tempScriptPath}`, (err, stdout, stderr) => {
        const output = stdout.trim() + (stderr ? `\nError: ${stderr}` : '');
        if (err) {
          log.error(`[Ops] Skill ${skill.id} failed: ${stderr || err.message}`);
          if (this.onSkillComplete) this.onSkillComplete(skill, false, output || err.message);
        } else {
          log.info(`[Ops] Skill ${skill.id} completed. Output: ${output}`);
          if (this.onSkillComplete) this.onSkillComplete(skill, true, output);
        }
        // Cleanup temp file
        try { fs.unlinkSync(tempScriptPath); } catch { /* ignore */ }
      });
    } catch (e) {
      log.error(`[Ops] Failed to execute skill ${skill.id}: ${String(e)}`);
      if (this.onSkillComplete) this.onSkillComplete(skill, false, String(e));
    }
  }
}
