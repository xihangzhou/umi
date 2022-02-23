export default function (path: string) {
  //   什么是扩展长度路径（extended-length paths）
  // 在 Windows 系统中，文件路径的最大长度为 MAX_PATH，默认为 260 个字符。但是 Windows API 中有些函数，具有 unicode 版本，以允许扩张路径长度，最大长度为 32767 个字符。要指定扩展长度路径，需要使用 \\?\ 作为前缀，例如：\\?\C:\长路径
  // 具体内容看这里
  const isExtendedLengthPath = /^\\\\\?\\/.test(path);
  if (isExtendedLengthPath) {
    return path;
  }

  // 把反斜杠转为正斜杠
  return path.replace(/\\/g, '/');
}
