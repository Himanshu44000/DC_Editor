import { Queue } from 'bullmq'
import { createRedisConnection } from './redis.js'

export const EXECUTION_QUEUE_NAME = 'execution-jobs'

let queueInstance = null

export const getExecutionQueue = () => {
  if (queueInstance) return queueInstance

  queueInstance = new Queue(EXECUTION_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  })

  return queueInstance
}

export const enqueueExecutionJob = async (payload) => {
  const queue = getExecutionQueue()
  const job = await queue.add('execute', payload, {
    jobId: payload.id,
  })
  return job.id
}
