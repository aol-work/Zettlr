import type { ToolSchema, ToolHandler } from './types'
import { getFileId, getFileDisplayTitle } from './common'
import type { AnyDescriptor, MDFileDescriptor } from '@dts/common/fsal'



export const zettlrSearchTagSchema: ToolSchema = {
  name: 'zettlr_search_tag',
  description: 'Search for files containing a specific tag. Tags can be inline #hashtags or defined in YAML frontmatter (tags/keywords fields). Case-insensitive matching.',
  inputSchema: {
    type: 'object',
    properties: {
      tag: {
        type: 'string',
        description: 'The tag to search for (without the # prefix). Example: "todo", "project", "meeting". Case-insensitive.'
      },
      sortBy: {
        type: 'string',
        description: 'How to sort the results',
        enum: [ 'relevance', 'name', 'modified', 'created' ],
        default: 'relevance'
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of files to return (default: 50)',
        default: 50,
        minimum: 1,
        maximum: 1000
      }
    },
    required: ['tag']
  },
  outputSchema: {
    type: 'object',
    properties: {
      tag: {
        type: 'string',
        description: 'The tag that was searched for'
      },
      totalResults: {
        type: 'number',
        description: 'Total number of files containing the tag'
      },
      files: {
        type: 'array',
        description: 'Array of files containing the tag',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'File title (from YAML frontmatter, H1 heading, or filename)'
            },
            path: {
              type: 'string',
              description: 'Full file path'
            },
            name: {
              type: 'string',
              description: 'File name with extension'
            },
            id: {
              type: 'string',
              description: 'File identifier (if available)'
            },
            modifiedDate: {
              type: 'string',
              description: 'File modification date in ISO format'
            },
            createdDate: {
              type: 'string',
              description: 'File creation date in ISO format'
            },
            size: {
              type: 'number',
              description: 'File size in bytes'
            },
            tags: {
              type: 'array',
              description: 'All tags associated with this file',
              items: {
                type: 'string'
              }
            }
          },
          required: ['title', 'path', 'name', 'modifiedDate', 'createdDate', 'size', 'tags']
        }
      }
    },
    required: ['tag', 'totalResults', 'files']
  }
}

export const zettlrSearchTagHandler: ToolHandler = async (args, context) => {
  const tag = args.tag as string
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 1000) : 50
  const sortBy = (args.sortBy as string) || 'relevance'

  if (typeof tag !== 'string' || tag.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: Tag must be a non-empty string'
      }],
      isError: true
    }
  }

  const searchTag = tag.toLowerCase().trim()
  context.logger.verbose(`[MCP] Searching for tag: "${searchTag}"`)

  try {
    const allFiles = context.workspaces.getAllFiles()
      .filter((file: AnyDescriptor): file is MDFileDescriptor => file.type === 'file')

    const matchingFiles: Array<{ file: MDFileDescriptor, relevance: number }> = []

    for (const file of allFiles) {
      let relevance = 0

      const inlineTags = file.tags.filter((t: string) => t.toLowerCase().includes(searchTag))
      relevance += inlineTags.length * 2
      if (file.frontmatter != null) {
        const yamlTags: string[] = []
        
        if (Array.isArray(file.frontmatter.tags)) {
          yamlTags.push(...file.frontmatter.tags.map((t: any) => String(t).toLowerCase()))
        }
        
        if (Array.isArray(file.frontmatter.keywords)) {
          yamlTags.push(...file.frontmatter.keywords.map((k: any) => String(k).toLowerCase()))
        }

        const yamlMatches = yamlTags.filter((t: string) => t.includes(searchTag))
        relevance += yamlMatches.length
      }

      if (relevance > 0) {
        matchingFiles.push({ file, relevance })
      }
    }

    if (sortBy === 'name') {
      matchingFiles.sort((a, b) => a.file.name.localeCompare(b.file.name))
    } else if (sortBy === 'modified') {
      matchingFiles.sort((a, b) => b.file.modtime - a.file.modtime)
    } else if (sortBy === 'created') {
      matchingFiles.sort((a, b) => b.file.creationtime - a.file.creationtime)
    } else {
      matchingFiles.sort((a, b) => b.relevance - a.relevance)
    }

    const limitedResults = matchingFiles.slice(0, maxResults)
    const files = limitedResults.map(({ file }) => {
      const fileTitle = getFileDisplayTitle(file)
      const fileId = getFileId(file.path, context)

      const fileTags = [...file.tags]
      if (file.frontmatter != null) {
        if (Array.isArray(file.frontmatter.tags)) {
          fileTags.push(...file.frontmatter.tags.map((t: any) => String(t)))
        }
        if (Array.isArray(file.frontmatter.keywords)) {
          fileTags.push(...file.frontmatter.keywords.map((k: any) => String(k)))
        }
      }

      return {
        title: fileTitle,
        path: file.path,
        name: file.name,
        id: fileId || undefined,
        modifiedDate: new Date(file.modtime).toISOString(),
        createdDate: new Date(file.creationtime).toISOString(),
        size: file.size,
        tags: fileTags
      }
    })

    const result = {
      tag: searchTag,
      totalResults: matchingFiles.length,
      files
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
    context.logger.error('[MCP] Error in tag search:', error)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          tag: tag || '',
          totalResults: 0,
          files: []
        })
      }],
      isError: true
    }
  }
}
