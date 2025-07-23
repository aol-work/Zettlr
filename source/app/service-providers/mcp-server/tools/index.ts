// Export types
export type { ToolSchema, ToolHandler, ToolResult, ToolContext } from './types'

// Export get-zettlr-version tool
export { getZettlrVersionSchema, getZettlrVersionHandler } from './get-zettlr-version'

// Export zettlr-search-title tool
export { zettlrSearchTitleSchema, zettlrSearchTitleHandler } from './zettlr-search-title'

// Export zettlr-search-keyword tool
export { zettlrSearchKeywordSchema, zettlrSearchKeywordHandler } from './zettlr-search-keyword'

// Export zettlr-read-file tool
export { zettlrReadFileSchema, zettlrReadFileHandler } from './zettlr-read-file'

// Import for convenience arrays
import { getZettlrVersionSchema, getZettlrVersionHandler } from './get-zettlr-version'
import { zettlrSearchTitleSchema, zettlrSearchTitleHandler } from './zettlr-search-title'
import { zettlrSearchKeywordSchema, zettlrSearchKeywordHandler } from './zettlr-search-keyword'
import { zettlrReadFileSchema, zettlrReadFileHandler } from './zettlr-read-file'

// Convenience array of all tool schemas
export const allToolSchemas = [
  getZettlrVersionSchema,
  zettlrSearchTitleSchema,
  zettlrSearchKeywordSchema,
  zettlrReadFileSchema
]

// Convenience map of tool handlers
export const toolHandlers = {
  'get-zettlr-version': getZettlrVersionHandler,
  'zettlr_search_title': zettlrSearchTitleHandler,
  'zettlr_search_keyword': zettlrSearchKeywordHandler,
  'zettlr_read_file': zettlrReadFileHandler
}
