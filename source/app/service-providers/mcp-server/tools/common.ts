import type { ToolContext } from './types'

/**
 * Gets the Zettlr internal ID for a file path if available
 *
 * @param   {string}      filePath  The file path
 * @param   {ToolContext} context   The tool context
 *
 * @return  {string}                The ID if found, empty string otherwise
 */
export function getFileId (filePath: string, context: ToolContext): string {
  const idMap = context.workspaces.getIds()
  return idMap.get(filePath) ?? ''
}
