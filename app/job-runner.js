import { runJob } from './processing.js'

await runJob(process.argv[2], JSON.parse(process.argv[3]))
