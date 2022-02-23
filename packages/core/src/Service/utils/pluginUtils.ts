import {
  compatESModuleRequire,
  createDebug,
  lodash,
  pkgUp,
  resolve,
  winPath,
} from '@umijs/utils';
import assert from 'assert';
import { existsSync } from 'fs';
import { basename, dirname, extname, join, relative } from 'path';
import { PluginType } from '../enums';
import { IPackage, IPlugin } from '../types';

const debug = createDebug('umi:core:Service:util:plugin');

interface IOpts {
  pkg: IPackage;
  cwd: string;
}

interface IResolvePresetsOpts extends IOpts {
  presets: string[];
  userConfigPresets: string[];
}

interface IResolvePluginsOpts extends IOpts {
  plugins: string[];
  userConfigPlugins: string[];
}

const RE = {
  [PluginType.plugin]: /^(@umijs\/|umi-)plugin-/,
  [PluginType.preset]: /^(@umijs\/|umi-)preset-/,
};

export function isPluginOrPreset(type: PluginType, name: string) {
  const hasScope = name.charAt(0) === '@';
  const re = RE[type];
  if (hasScope) {
    return re.test(name.split('/')[1]) || re.test(name);
  } else {
    return re.test(name);
  }
}

// 从四个来源中获取presets或plugins的绝对路径
function getPluginsOrPresets(
  type: PluginType,
  opts: IResolvePresetsOpts | IResolvePluginsOpts,
): string[] {
  const upperCaseType = type.toUpperCase();
  return [
    // opts
    // 自定义service入参中的presets
    ...((opts[type === PluginType.preset ? 'presets' : 'plugins'] as any) ||
      []),
    // env
    // env中的UMI_PRESETS也可以指定
    ...(process.env[`UMI_${upperCaseType}S`] || '').split(',').filter(Boolean),
    // dependencies
    // 从package.json的devDependencies和dependencies中筛选符合要求的prestes和插件
    ...Object.keys(opts.pkg.devDependencies || {})
      .concat(Object.keys(opts.pkg.dependencies || {}))
      .filter(isPluginOrPreset.bind(null, type)),
    // user config
    // 从用户的配置文件中获取presets
    ...((opts[
      type === PluginType.preset ? 'userConfigPresets' : 'userConfigPlugins'
    ] as any) || []),
  ].map((path) => {
    if (typeof path !== 'string') {
      throw new Error(
        `Plugin resolved failed, Please check your plugins config, it must be array of string.\nError Plugin Config: ${JSON.stringify(
          path,
        )}`,
      );
    }
    // 同步解析preset或者是plugin的绝对路径
    // extensions 表示该路径下顺位寻找 js 或是 ts 文件
    return resolve.sync(path, {
      basedir: opts.cwd,
      extensions: ['.js', '.ts'],
    });
  });
}

// e.g.
// initial-state -> initialState
// webpack.css-loader -> webpack.cssLoader
function nameToKey(name: string) {
  return name
    .split('.')
    .map((part) => lodash.camelCase(part))
    .join('.');
}

function pkgNameToKey(pkgName: string, type: PluginType) {
  // strip none @umijs scope
  // 如果是由@开头并且不是@umijs/项目就把@umijs/去掉
  if (pkgName.charAt(0) === '@' && !pkgName.startsWith('@umijs/')) {
    pkgName = pkgName.split('/')[1];
  }
  return nameToKey(pkgName.replace(RE[type], '')); // 去掉umijs前缀
}

// 把这些插件或者是presets的绝对路径转换成存放了对应信息的对象
export function pathToObj({
  type, // 是plugin还是presets
  path, // plugin或者是presets的绝对路径
  cwd, // 项目根目录
}: {
  type: PluginType;
  path: string;
  cwd: string;
}) {
  let pkg = null;
  let isPkgPlugin = false;

  // 确定是否存在path这个路径
  assert(existsSync(path), `${type} ${path} not exists, pathToObj failed`);

  // 寻找这个path路径下的package.json文件,返回这个文件的绝对地址
  const pkgJSONPath = pkgUp.sync({ cwd: path });
  if (pkgJSONPath) {
    pkg = require(pkgJSONPath);
    isPkgPlugin =
      winPath(join(dirname(pkgJSONPath), pkg.main || 'index.js')) ===
      winPath(path); // isPkgPlugin 表示是否是 persets
  }

  // 对于不同的路径找到一个唯一的id值
  let id;
  if (isPkgPlugin) {
    // 如果是plugin直接用name作为id即可
    id = pkg!.name; // ts中的语法，意味着强制生命pkg中有name这个属性
  } else if (winPath(path).startsWith(winPath(cwd))) {
    // 如果是放在这个项目中的依赖就使用相对路径作为id
    id = `./${winPath(relative(cwd, path))}`;
  } else if (pkgJSONPath) {
    // 否则如果存在package.json的话就使用package.json在这个依赖目录的相对路径
    id = winPath(join(pkg!.name, relative(dirname(pkgJSONPath), path)));
  } else {
    id = winPath(path); // 否则直接使用绝对路径作为id
  }
  id = id.replace('@umijs/preset-built-in/lib/plugins', '@@');
  id = id.replace(/\.js$/, '');

  // 生成key
  const key = isPkgPlugin
    ? pkgNameToKey(pkg!.name, type)
    : // basename(path, extname(path)返回去除文件后缀的文件名
      nameToKey(basename(path, extname(path)));

  return {
    id,
    key,
    path: winPath(path),
    apply() {
      // use function to delay require
      try {
        const ret = require(path);
        // use the default member for es modules
        return compatESModuleRequire(ret);
      } catch (e) {
        throw new Error(`Register ${type} ${path} failed, since ${e.message}`);
      }
    },
    defaultConfig: null,
  };
}

// 从配置文件中获取presets
// 为了方便理解，我们举个例子，我们在 package.json 中安装了 @umijs/preset-react，那最终会生成这样一个对象{
//   id: '@umijs/preset-react',
//   key: 'react',
//   path: '项目地址/node_modules/@umijs/preset-react/lib/index.js',
//   apply: ...,
//   defaultConfig: null
// }
export function resolvePresets(opts: IResolvePresetsOpts) {
  const type = PluginType.preset;
  const presets = [...getPluginsOrPresets(type, opts)]; // 获取所有prestes的绝对路径
  debug(`preset paths:`);
  debug(presets);
  return presets.map((path: string) => {
    return pathToObj({
      type,
      path,
      cwd: opts.cwd,
    });
  });
}

export function resolvePlugins(opts: IResolvePluginsOpts) {
  const type = PluginType.plugin;
  const plugins = getPluginsOrPresets(type, opts);
  debug(`plugin paths:`);
  debug(plugins);
  return plugins.map((path: string) => {
    return pathToObj({
      type,
      path,
      cwd: opts.cwd,
    });
  });
}

export function isValidPlugin(plugin: IPlugin) {
  return plugin.id && plugin.key && plugin.apply;
}
