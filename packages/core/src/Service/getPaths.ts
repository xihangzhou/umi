import { lodash, winPath } from '@umijs/utils';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { IServicePaths } from './types';

function isDirectoryAndExist(path: string) {
  return existsSync(path) && statSync(path).isDirectory();
}

function normalizeWithWinPath<T extends Record<any, string>>(obj: T) {
  return lodash.mapValues(obj, (value) => winPath(value));
}

export default function getServicePaths({
  cwd,
  config,
  env,
}: {
  cwd: string;
  config: any;
  env?: string;
}): IServicePaths {
  // absSrcPath 表示项目的根目录
  let absSrcPath = cwd;

  // 如果src目录存在并且是一个目录。就保存src文件的绝对目录
  if (isDirectoryAndExist(join(cwd, 'src'))) {
    absSrcPath = join(cwd, 'src');
  }

  // 如果配置了 singular，那么就是 src/page，默认是 src/pages
  const absPagesPath = config.singular
    ? join(absSrcPath, 'page')
    : join(absSrcPath, 'pages');

  // 临时文件路径
  const tmpDir = ['.umi', env !== 'development' && env] // 如果是development 环境不要env否则加上env，比如如果是production环境，就是 .umi-production
    .filter(Boolean)
    .join('-');
  // 把每一个路径都window化一下
  return normalizeWithWinPath({
    cwd,
    absNodeModulesPath: join(cwd, 'node_modules'),
    absOutputPath: join(cwd, config.outputPath || './dist'),
    absSrcPath,
    absPagesPath,
    absTmpPath: join(absSrcPath, tmpDir),
  });
}
