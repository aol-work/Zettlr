import type LogProvider from '../../log'
import type WorkspaceProvider from '../../workspaces'
import type FSAL from '../../fsal'

export interface ToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

export interface ToolResult {
  content: Array<{
    type: 'text'
    text: string
  }>
}

export interface ToolContext {
  logger: LogProvider
  workspaces: WorkspaceProvider
  fsal: FSAL
}

export type ToolHandler = (args: any, context: ToolContext) => Promise<ToolResult>
