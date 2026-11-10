import { localStore } from './store'

const paused = localStore<boolean>('deck.aiPaused', () => false)

export const useAiPaused = paused.use
export const setAiPaused = paused.set
