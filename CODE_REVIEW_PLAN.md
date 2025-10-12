# Line-by-line JS Code Review Plan

> 目标：对仓库内全部 JavaScript 文件逐行审阅，逐项记录发现与状态。

## 根目录
- [x] index.js

## lib/
- [x] lib/browserLauncher.js
- [x] lib/downloadQueue.js
- [x] lib/pageLoader.js
- [x] lib/configValidator.js
- [x] lib/imageExtractor.js
- [x] lib/scraperOrchestrator.js
- [x] lib/publicApi.js
- [x] lib/tempFileStore.js
- [x] lib/localHtmlProcessor.js
- [x] lib/fileManager.js
- [x] lib/imageFetcher.js
- [x] lib/imageModeProcessor.js
- [x] lib/imageAnalyzer.js

### lib/browser-scripts/
- [x] lib/browser-scripts/imageExtractorClient.js

### lib/fetcher/
- [x] lib/fetcher/axiosFetcher.js
- [x] lib/fetcher/strategySelector.js
- [x] lib/fetcher/puppeteerFetcher.js

## utils/
- [x] utils/fileNameSanitizer.js
- [x] utils/logger.js
- [x] utils/imageUrlConverter.js
- [x] utils/fileUtils.js
- [x] utils/htmlMemoryManager.js
- [x] utils/contentPolicy.js
- [x] utils/errors.js
- [x] utils/imageUtils.js
- [x] utils/antiDetection.js

## config/
- [x] config/logConfig.js
- [x] config/config.js

## tests/
- [x] tests/e2e.twoPhase-retry.test.js
- [x] tests/configValidator.format-convertTo.test.js
- [x] tests/e2e.svg-text-plain.test.js
- [x] tests/fileManager.saveImage.unit.test.js
- [x] tests/e2e.processing-timeout-retry.test.js
- [x] tests/e2e.headers-attachment-missing-ct.test.js
- [x] tests/fetchImage.acceptPropagation.test.js
- [x] tests/e2e.memory-error-retry.test.js
- [x] tests/twoPhase/tempCleanup.test.js
- [x] tests/twoPhase/maxHoldBuffers.test.js
- [x] tests/downloadQueue.stats.test.js
- [x] tests/downloadQueue.stats-reference.test.js
- [x] tests/imageAnalyzer.test.js
- [x] tests/e2e.unsupported-content-type.test.js
- [x] tests/imageAnalyzer.strictValidation.test.js
- [x] tests/imageAnalyzer.errors.test.js
- [x] tests/twoPhase.stats-reference.test.js
- [x] tests/downloadQueue.observability.test.js
- [x] tests/e2e.corrupted-image-continues.test.js
- [x] tests/imageAnalyzer.invalidDimensions.test.js
- [x] tests/e2e.analyze-retry.test.js
- [x] tests/e2e.oversized-skip.test.js
- [x] tests/e2e.local-html.test.js
- [x] tests/downloadQueue.int.test.js
- [x] tests/twoPhase.format-aggregation.test.js
- [x] tests/fetcher/axiosFetcher.p1.test.js
