import { Injectable } from '@nestjs/common';
import { AgentDef, AgentError, AgentToolDef } from './agent.types';

/**
 * The in-code registry of agents and tools, and the enforcement point for the
 * least-privilege rule: an agent may call ONLY the tools named in its own
 * allow-list. `resolveTool` is the security check the kernel runs on every call
 * — a tool that is not registered, or not in this agent's list, is rejected with
 * a typed `TOOL_OUT_OF_SCOPE` error and never runs.
 *
 * Pure logic over two maps, so it unit-tests without a database. Registration
 * happens once at module init (see AgentsModule); nothing mutates the registry
 * at request time, which is itself part of the injection-defense posture — an
 * agent cannot expand its own tool set at runtime (WR-AGT-7).
 */
@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, AgentToolDef>();
  private readonly agents = new Map<string, AgentDef>();

  registerTool(tool: AgentToolDef): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerAgent(agent: AgentDef): void {
    if (this.agents.has(agent.name)) {
      throw new Error(`duplicate agent registration: ${agent.name}`);
    }
    // Fail fast if an agent's allow-list names a tool that does not exist —
    // a typo must not silently become an always-blocked call at runtime.
    for (const t of agent.tools) {
      if (!this.tools.has(t)) {
        throw new Error(`agent '${agent.name}' allow-lists unknown tool '${t}'`);
      }
    }
    this.agents.set(agent.name, agent);
  }

  getAgent(agentName: string): AgentDef {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new AgentError('UNKNOWN_AGENT', `no such agent: ${agentName}`, { agentName });
    }
    return agent;
  }

  /**
   * Resolve a tool for a given agent, enforcing the allow-list. Throws
   * `TOOL_OUT_OF_SCOPE` if the agent may not call it, or if it is unregistered.
   */
  resolveTool(agentName: string, toolName: string): AgentToolDef {
    const agent = this.getAgent(agentName);
    if (!agent.tools.includes(toolName)) {
      throw new AgentError(
        'TOOL_OUT_OF_SCOPE',
        `agent '${agentName}' may not call tool '${toolName}'`,
        { agentName, toolName },
      );
    }
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new AgentError('TOOL_OUT_OF_SCOPE', `tool not registered: ${toolName}`, { toolName });
    }
    return tool;
  }

  listAgents(): Array<{ name: string; description: string; tools: string[] }> {
    return [...this.agents.values()].map((a) => ({
      name: a.name,
      description: a.description,
      tools: a.tools,
    }));
  }
}
