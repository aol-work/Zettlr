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

export interface ToolContentImage {
  type: 'image'
  data: string
  mimeType: string
}

export interface ToolContentAudio {
  type: 'audio'
  data: string
  mimeType: string
}

export interface ToolContentResource {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    text?: string
  }
}

export type ToolContent = ToolContentText | ToolContentImage | ToolContentAudio | ToolContentResource

export interface ToolResult {
  content: ToolContent[]
  structuredContent?: any
  isError: boolean
}

export interface ToolContext {
  logger: LogProvider
  workspaces: WorkspaceProvider
  fsal: FSAL
}

export type ToolHandler = (args: any, context: ToolContext) => Promise<ToolResult>
