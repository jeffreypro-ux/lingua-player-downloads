import { getTranslator, translateTexts, translationPaths } from '../translation.mjs';

let lastProgress = -1;
const progress = event => {
  const value = Math.round(Number(event?.progress || 0));
  if (value >= lastProgress + 10) {
    lastProgress = value;
    console.log(`translation-model ${value}% ${event?.file || ''}`);
  }
};

await getTranslator(progress);
const [sample] = await translateTexts(['Learning a language takes consistent practice.']);
console.log(`translation-test: ${sample}`);
console.log(`cache: ${translationPaths.cacheDir}`);
