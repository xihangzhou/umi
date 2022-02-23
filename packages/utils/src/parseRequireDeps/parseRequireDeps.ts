// @ts-ignore
// @ts-ignore
import crequire from '@umijs/deps/compiled/crequire';
// @ts-ignore
import lodash from '@umijs/deps/compiled/lodash';
import resolve from '@umijs/deps/compiled/resolve';
import { readFileSync } from 'fs';
import { dirname } from 'path';
import winPath from '../winPath/winPath';

// 获取filePath文件中引用的同级依赖
function parse(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  // 给一个文件路径，通过crequire去分析该文件requiere了的依赖。
  return (crequire(content) as any[])
    .map<string>((o) => o.path) // 拿到分析过后的路径
    .filter((path) => path.charAt(0) === '.') // 筛选出相对路径为同级的路径
    .map((path) =>
      winPath(
        // 使用resolve.sync去返回这些依赖的绝对路径
        resolve.sync(path, {
          basedir: dirname(filePath),
          extensions: ['.tsx', '.ts', '.jsx', '.js'],
        }),
      ),
    );
}

// 从filePath开始，一直往下获取所有的依赖的绝对路径，并且filePath也会在其中
export default function parseRequireDeps(filePath: string): string[] {
  const paths = [filePath];
  const ret = [winPath(filePath)];

  while (paths.length) {
    // 通过lodash.pullAll每次清除一下已经parse过的文件避免依赖循环
    const extraPaths = lodash.pullAll(parse(paths.shift()!), ret); // 这里先shift paths
    if (extraPaths.length) {
      paths.push(...extraPaths); // 然后再加入新的依赖的路径
      ret.push(...extraPaths);
    }
  }

  return ret;
}
