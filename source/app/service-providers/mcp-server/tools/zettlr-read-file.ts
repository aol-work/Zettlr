import { readFile } from 'fs/promises'
import type { ToolSchema, ToolHandler } from './types'

export const zettlrReadFileSchema: ToolSchema = {
  name: 'zettlr_read_file',
  description: 'Read the full contents of a specified file. Allows retrieving the complete text of a note after identifying it via search tools.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read. Can be an absolute path or relative path within the workspace.'
      }
    },
    required: ['path']
  }
}

export const zettlrReadFileHandler: ToolHandler = async (args, context) => {
  const filePath = args.path as string

  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: Path must be a non-empty string'
      }]
    }
  }

  try {
    // Get all files to validate the path exists in our workspace
    const allFiles = context.workspaces.getAllFiles()
    const fileDescriptor = allFiles.find((file: any) => file.path === filePath)

    if (!fileDescriptor) {
      return {
        content: [{
          type: 'text',
          text: `Error: File not found at path "${filePath}". Make sure the file exists in the current workspace.`
        }]
      }
    }

    // Only allow reading text files
    if (fileDescriptor.type !== 'file') {
      return {
        content: [{
          type: 'text',
          text: `Error: "${filePath}" is not a file`
        }]
      }
    }

    // Read the file content
    const fileContent = await readFile(filePath, 'utf8')

    return {
      content: [{
        type: 'text',
        text: fileContent
      }]
    }
  } catch (error) {
    context.logger.error('[MCP] Error reading file:', error)
    return {
      content: [{
        type: 'text',
        text: `Error reading file "${filePath}": ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    }
  }
}
