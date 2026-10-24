import { create } from 'zustand'

type ExerciseValidationAccess = { projectId: string | null; viewerId: string | null; allowed: boolean }

/** Viewer-specific access; never persisted into project data or undo history. */
export const useExerciseValidationAccessStore = create<ExerciseValidationAccess>(() => ({
  projectId: null, viewerId: null, allowed: false,
}))

export function isExerciseValidationAllowed(projectId: string, cloudProject: boolean): boolean {
  if (!cloudProject) return true
  const access = useExerciseValidationAccessStore.getState()
  return access.projectId === projectId && access.allowed
}
