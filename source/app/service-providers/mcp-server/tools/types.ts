import type LogProvider from '../../log'
import type FSAL from '../../fsal'

export interface ToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
  outputSchema?: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

// Updated to match MCP 2025-06-18 specification
export interface ToolContentText {
  type: 'text'
  text: string
}

export type ToolContent = ToolContentText

export interface ToolResult {
  content: ToolContent[]
  structuredContent?: any
  isError: boolean
}

export interface ToolContext {
  logger: LogProvider
  fsal: FSAL
}

export type ToolHandler = (args: any, context: ToolContext) => Promise<ToolResult>
