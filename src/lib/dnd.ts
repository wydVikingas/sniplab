/** Drag-and-drop payload types used between the snippet list and the library nav. */
export const SNIPPET_MIME = 'application/x-sniplab-snippet'
export const FOLDER_MIME = 'application/x-sniplab-folder'

export function dragKind(e: React.DragEvent): 'snippet' | 'folder' | null {
  const types = e.dataTransfer.types
  if (types.includes(SNIPPET_MIME)) return 'snippet'
  if (types.includes(FOLDER_MIME)) return 'folder'
  return null
}

export function startDrag(e: React.DragEvent, mime: string, id: string): void {
  e.dataTransfer.setData(mime, id)
  e.dataTransfer.effectAllowed = 'move'
}
