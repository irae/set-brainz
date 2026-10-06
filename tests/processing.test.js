import { test } from 'tap'
import { makeEmptyDataDir } from './helpers/fixtures.js'
import { getProcessingStatus, startDownload } from '../app/processing.js'

test('a job started in a detached runner (functional)', async (t) => {
  const dir = makeEmptyDataDir(t)
  process.env.SETBRAINZ_DATA_DIR = dir
  const videoId = 'TESTVIDEO01'

  const started = startDownload(videoId, 'http://127.0.0.1:9/fixture')
  const status = getProcessingStatus(videoId)

  t.equal(status.status, 'queued', 'a status read just after the start sees a live job')
  t.equal(status.processGroupId, started.processGroupId)
  t.throws(() => startDownload(videoId, 'http://127.0.0.1:9/fixture'), { code: 'processing_in_progress' }, 'a second start of the same set is refused')

  let final = status
  for (let i = 0; i < 300 && (final.status === 'queued' || final.status === 'running'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    final = getProcessingStatus(videoId)
  }
  t.equal(final.status, 'failed', 'the runner writes the end of the job')
  t.equal(final.processGroupId, null)
  t.not(final.error, 'work stopped when the app server stopped', 'the error holds the output of the step')
  t.end()
})
