import { app } from 'electron'
import type { ToolSchema, ToolHandler } from './types'

export const getZettlrVersionSchema: ToolSchema = {
  name: 'get-zettlr-version',
  description: 'Get the version of Zettlr',
  inputSchema: {
    type: 'object',
    properties: {
      random_string: {
        type: 'string',
        description: 'Dummy parameter for no-parameter tools'
      }
    },
    required: ['random_string']
  },
  outputSchema: {
    type: 'object',
    properties: {
      version: {
        type: 'string',
        description: 'Full version string'
      },
      app: {
        type: 'string',
        description: 'Application name'
      },
      major: {
        type: 'number',
        description: 'Major version number'
      },
      minor: {
        type: 'number',
        description: 'Minor version number'
      },
      patch: {
        type: 'number',
        description: 'Patch version number'
      }
    },
    required: [ 'version', 'app', 'major', 'minor', 'patch' ]
  }
}

export const getZettlrVersionHandler: ToolHandler = async (_args, _context) => {
  const version = app.getVersion()
  const [ major, minor, patch ] = version.split('.').map(Number)
  
  const versionData = {
    version,
    app: 'Zettlr',
    major,
    minor,
    patch
  }

  return {
    // Backwards compatibility: unstructured content
    content: [{
      type: 'text',
      text: JSON.stringify(versionData, null, 2)
    }],
    // MCP 2025-06-18: Structured content for better client integration
    structuredContent: versionData,
    isError: false
  }
}
