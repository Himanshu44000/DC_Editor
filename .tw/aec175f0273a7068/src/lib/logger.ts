export const logInfo = (message: string): void => {
  const now = new Date().toISOString()
  console.log(`[${now}] INFO: ${message}`)
}
