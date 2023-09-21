// 定义一个函数，接受一个文件名作为参数，返回一个符合Windows文件命名规则的文件名
export function validateAndModifyFileName(fileName) {
  // 定义一个正则表达式，匹配Windows文件命名规则中不允许的字符
  let invalidChars = /[\\/:*?\"<>|]/g
  // 定义一个数组，存储Windows文件命名规则中的保留字
  let reservedWords = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9'
  ]
  // 定义一个变量，存储文件名的最大长度
  let maxLength = 260
  // 定义一个变量，存储修改后的文件名
  let modifiedFileName = fileName
  // 如果文件名包含不允许的字符，用下划线替换它们
  if (invalidChars.test(modifiedFileName)) {
    modifiedFileName = modifiedFileName.replace(invalidChars, '_')
  }
  // 如果文件名以空格或句点结尾，去掉它们
  if (modifiedFileName.endsWith(' ') || modifiedFileName.endsWith('.')) {
    modifiedFileName = modifiedFileName.slice(0, -1)
  }
  // 如果文件名是保留字，或者与保留字加上扩展名相同，用下划线替换它们
  let fileNameWithoutExtension = modifiedFileName.split('.')[0]
  let fileExtension = modifiedFileName.split('.')[1]
  if (reservedWords.includes(fileNameWithoutExtension) || reservedWords.includes(modifiedFileName)) {
    modifiedFileName = '_' + (fileExtension ? '.' + fileExtension : '')
  }
  // 如果文件名的长度超过最大长度，截取它
  if (modifiedFileName.length > maxLength) {
    modifiedFileName = modifiedFileName.slice(0, maxLength)
  }
  // 返回修改后的文件名
  return modifiedFileName
}
