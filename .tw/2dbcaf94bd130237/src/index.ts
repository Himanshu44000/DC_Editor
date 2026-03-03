import { env } from './config/env'
import { logInfo } from './lib/logger'

const main = (): void => {
  logInfo(`Starting ${env.APP_NAME} in ${env.NODE_ENV} mode`)
  logInfo(`Server would run on port ${env.PORT}`)
}

main()
