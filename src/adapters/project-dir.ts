/** The env variable each agent sets to its project root; `JIG_PROJECT_DIR` names it under any agent. */
export const JIG_PROJECT_DIR = 'JIG_PROJECT_DIR'

export const AGENT_PROJECT_DIRS = { claude: 'CLAUDE_PROJECT_DIR' } as const

export const PROJECT_DIR_ENVS: readonly string[] = [JIG_PROJECT_DIR, ...Object.values(AGENT_PROJECT_DIRS)]
