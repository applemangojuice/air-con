/**
 * In-memory registry for photo Files picked during the survey.
 * Files live here (keyed by photo id) until submit, when they're uploaded to
 * Supabase Storage. Only metadata is persisted to localStorage.
 */

const files = new Map<string, File>();
const previews = new Map<string, string>();

export function registerPhotoFile(file: File): { id: string; previewUrl: string } {
  const id = crypto.randomUUID();
  files.set(id, file);
  const previewUrl = URL.createObjectURL(file);
  previews.set(id, previewUrl);
  return { id, previewUrl };
}

export function getPhotoFile(id: string): File | undefined {
  return files.get(id);
}

export function getPhotoPreview(id: string): string | undefined {
  return previews.get(id);
}

export function releasePhoto(id: string): void {
  files.delete(id);
  const url = previews.get(id);
  if (url) URL.revokeObjectURL(url);
  previews.delete(id);
}
