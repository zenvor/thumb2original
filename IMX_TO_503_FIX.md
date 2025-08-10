# imx.to 503 故障排除指引

本项目在核心库 `@crawler/core` 中对 `imx.to` 做了适配（siteConfig：Referer、自定义请求头、Axios→Puppeteer 回退）。当遇到 503 或高失败率，可按以下建议：

## 建议配置
- 将并发降到 2：`concurrentDownloads: 2`
- 增加批次延迟：`minRequestDelayMs: 1500`、`maxRequestDelayMs: 2500`
- 可选限速：`network.bandwidthLimitKbps: 192`（单位 KB/s）
- 确保 `needsReferer/customHeaders` 已开启（核心库已内置）

## 运行 e2e 验证
```bash
IMX_URL="https://imx.to/your_gallery" npm run test:e2e:imx
```
脚本会临时切换到 `single_page` 并在结束后写回配置。

## 常见问题
- 仍然 503：进一步降低并发/提高延迟，或减少单批数量
- 触发 Cloudflare：重试后会触发 Puppeteer 回退（带页面上下文），成功率更高
- 下载很慢：取消或提高带宽上限（`network.bandwidthLimitKbps`）

如修改了核心库 `siteConfig`，请同步更新本说明。
