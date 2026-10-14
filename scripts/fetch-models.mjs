// Downloads the models the worker runs into STUDIO_MODELS_DIR (default
// .data/models) and verifies their checksums. All are from the OpenCV Zoo:
// YuNet (MIT) for face detection, SFace (Apache-2.0) for face embeddings,
// and PP-HumanSeg (Apache-2.0) for her outline in the edits that put
// something behind her.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.env.STUDIO_MODELS_DIR || '.data/models'
const MODELS = [
  { file: 'face_detection_yunet_2023mar.onnx', url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx', sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4' },
  { file: 'face_recognition_sface_2021dec.onnx', url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx', sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79' },
  { file: 'human_segmentation_pphumanseg_2023mar.onnx', url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx', sha256: '552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24' },
]

mkdirSync(DIR, { recursive: true })
for (const m of MODELS) {
  const path = join(DIR, m.file)
  const sum = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : ''
  if (sum === m.sha256) { console.log(`ok  ${m.file}`); continue }
  process.stdout.write(`get ${m.file} ... `)
  const res = await fetch(m.url)
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${m.file}`)
  const data = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(data).digest('hex')
  if (got !== m.sha256) throw new Error(`Checksum mismatch for ${m.file}: ${got}`)
  writeFileSync(path, data)
  console.log('done')
}
