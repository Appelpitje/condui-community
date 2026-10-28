import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

/** Reset on a source transition, without changing a loader's later completion policy. */
export function useArtworkValue<T>(source: readonly unknown[], initial: T, resetOnChange: boolean) {
  const [state, setState] = useState({ source, value: initial })
  if (
    source.length !== state.source.length ||
    source.some((value, index) => !Object.is(value, state.source[index]))
  ) {
    setState({ source, value: resetOnChange ? initial : state.value })
  }
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setState((current) => ({
      ...current,
      value: typeof update === 'function' ? (update as (previous: T) => T)(current.value) : update,
    }))
  }, [])
  return [state.value, setValue] as const
}
