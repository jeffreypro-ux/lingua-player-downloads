import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(appRoot, 'tools', 'translation-cache');
const readyMarker = path.join(cacheDir, '.ready');
const modelId = 'onnx-community/opus-mt-en-zh';
let translatorPromise;

env.cacheDir = cacheDir;
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.logLevel = 30;

export async function getTranslator(progressCallback) {
  if (!translatorPromise) {
    translatorPromise = pipeline('translation', modelId, {
      dtype: 'q4',
      progress_callback: progressCallback,
    }).then(async translator => {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(readyMarker, `${modelId}\nq4\n`, 'utf8');
      return translator;
    }).catch(error => {
      translatorPromise = undefined;
      throw error;
    });
  }
  return translatorPromise;
}

export async function translateTexts(texts, progressCallback) {
  if (!texts.length) return [];
  const translator = await getTranslator(progressCallback);
  const results = await translator(texts, { max_new_tokens: 160 });
  return results.map(result => {
    const item = Array.isArray(result) ? result[0] : result;
    return item?.translation_text?.trim() || '';
  });
}

export const translationPaths = { cacheDir, readyMarker, modelId };
