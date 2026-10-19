import { createContext } from 'react'

/** Live detail windows stay local; selection and export can materialize the complete drawing. */
export const DiagramDetailContext = createContext({ localized: false, materialized: false })
