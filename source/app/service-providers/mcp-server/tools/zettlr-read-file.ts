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
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Full file path'
      },
      name: {
        type: 'string',
        description: 'File name with extension'
      },
      content: {
        type: 'string',
        description: 'Complete file content as text'
      },
      size: {
        type: 'number',
        description: 'File size in bytes'
      },
      type: {
        type: 'string',
        description: 'File type'
      },
      encoding: {
        type: 'string',
        description: 'File encoding used for reading'
      }
    },
    required: [ 'path', 'name', 'content', 'size', 'type', 'encoding' ]
  }
}

export const zettlrReadFileHandler: ToolHandler = async (args, context) => {
  const filePath = args.path as string

  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: Path must be a non-empty string'
      }],
      isError: true
    }
  }

  try {
    const allFiles = await context.fsal.getAllLoadedDescriptors()
    const fileDescriptor = allFiles.find(file => file.path === filePath)

    if (fileDescriptor === undefined) {
      return {
        content: [{
          type: 'text',
          text: `Error: File not found at path "${filePath}". Make sure the file exists in the current workspace.`
        }],
        isError: true
      }
    }

    if (fileDescriptor.type !== 'file' && fileDescriptor.type !== 'code') {
      return {
        content: [{
          type: 'text',
          text: `Error: "${filePath}" is not a readable file type`
        }],
        isError: true
      }
    }

    const fileContent = await readFile(filePath, 'utf8')

    const result = {
      path: filePath,
      name: fileDescriptor.name,
      content: fileContent,
      size: fileDescriptor.size || fileContent.length,
      type: fileDescriptor.type,
      encoding: 'utf8'
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }],
      structuredContent: result,
      isError: false
    }
  } catch (error) {
    context.logger.error('[MCP] Error reading file:', error)
    return {
      content: [{
        type: 'text',
        text: `Error reading file "${filePath}": ${error instanceof Error ? error.message : 'Unknown error'}`
      }],
      isError: true
    }
  }
}
