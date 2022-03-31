export const files = [
  'webpack/lib/Chunk',
  'webpack/lib/Compilation',
  'webpack/lib/dependencies/ConstDependency',
  'webpack/lib/javascript/JavascriptParserHelpers',
  'webpack/lib/LibraryTemplatePlugin',
  'webpack/lib/LoaderTargetPlugin',
  'webpack/lib/node/NodeTargetPlugin',
  'webpack/lib/node/NodeTemplatePlugin',
  'webpack/lib/ModuleFilenameHelpers',
  'webpack/lib/NormalModule',
  'webpack/lib/RequestShortener',
  'webpack/lib/RuntimeGlobals',
  'webpack/lib/RuntimeModule',
  'webpack/lib/optimize/LimitChunkCountPlugin',
  'webpack/lib/ParserHelpers',
  'webpack/lib/SingleEntryPlugin',
  'webpack/lib/Template',
  'webpack/lib/webworker/WebWorkerTemplatePlugin',
];

export function getFileName(filePath: string) {
  return filePath.split('/').slice(-1)[0];
}

let inited = false;

export function init() {
  // Allow run once
  if (inited) return;
  inited = true;

  // 把上述的在webpack项目中的文件路径对应到@umijs/deps/compiled/webpack/${fileName}路径
  const filesMap = files.map((file) => {
    const fileName = getFileName(file);
    return [file, `@umijs/deps/compiled/webpack/${fileName}`];
  });

  // 建立文件名到这个文件的绝对路径的映射
  const hookPropertyMap = new Map(
    [
      ['webpack', '@umijs/deps/compiled/webpack'],
      ['webpack/package.json', '@umijs/deps/compiled/webpack/pkgInfo'],
      ...filesMap,
      // ['webpack-sources', '@umijs/deps/compiled/webpack/sources'],
    ].map(([request, replacement]) => [request, require.resolve(replacement)]),
  );

  // 解析module模块
  const mod = require('module');
  const resolveFilename = mod._resolveFilename;
  // 把_resolveFilename用下面这个方法包一层放到mod的_resolveFilename中
  mod._resolveFilename = function (
    request: string,
    parent: any,
    isMain: boolean,
    options: any,
  ) {
    const hookResolved = hookPropertyMap.get(request);
    if (hookResolved) request = hookResolved;
    // 最后返回resolveFilename指向mod实例的执行结果，解析request
    return resolveFilename.call(mod, request, parent, isMain, options);
  };
}
