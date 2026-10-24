import { useProjectStore } from '@/stores/projectStore'
import { useExerciseValidationAccessStore } from '@/stores/exerciseValidationAccessStore'

export function useCanValidateCurrentProject(): boolean {
  const projectId = useProjectStore((state) => state.currentProject?.project.id ?? null)
  const cloudProject = useProjectStore((state) => state.currentProjectStorageMode === 'cloud')
  return useExerciseValidationAccessStore((access) => !cloudProject || (access.projectId === projectId && access.allowed))
}
