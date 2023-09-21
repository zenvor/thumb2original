/**
 * 差分算法，比较两个字符串之间的差异
 * @param {string} firstTextString
 * @param {string} secondTextString
 * @returns
 */
export function lcsDiff(firstTextString, secondTextString) {
  const m = firstTextString.length
  const n = secondTextString.length

  // 创建一个二维数组来存储LCS的长度
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  // 填充dp数组
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (firstTextString[i - 1] === secondTextString[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 从dp数组中构建LCS
  const lcs = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (firstTextString[i - 1] === secondTextString[j - 1]) {
      lcs.unshift(firstTextString[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      lcs.unshift(`*-${firstTextString[i - 1]}`)
      i--
    } else {
      lcs.unshift(`*+${secondTextString[j - 1]}`)
      j--
    }
  }

  // 处理剩余的部分
  while (i > 0) {
    lcs.unshift(`*-${firstTextString[i - 1]}`)
    i--
  }
  while (j > 0) {
    lcs.unshift(`*+${secondTextString[j - 1]}`)
    j--
  }

  return lcs.join(' ')
}
