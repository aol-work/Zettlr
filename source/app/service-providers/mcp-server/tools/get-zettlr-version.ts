import { app } from 'electron'
import type { ToolSchema, ToolHandler } from './types'

export const getZettlrVersionSchema: ToolSchema = {
  name: 'get-zettlr-version',
  description: 'Get the version of Zettlr',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
}

export const getZettlrVersionHandler: ToolHandler = async (_args, _context) => {
  return {
    content: [{
      type: 'text',
      text: app.getVersion()
    }]
  }
}
