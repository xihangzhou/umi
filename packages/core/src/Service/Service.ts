import { AsyncSeriesWaterfallHook } from '@umijs/deps/compiled/tapable';
import { BabelRegister, lodash, NodeEnv } from '@umijs/utils';
import assert from 'assert';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join } from 'path';
import Config from '../Config/Config';
import { getUserConfigWithKey } from '../Config/utils/configUtils';
import Logger from '../Logger/Logger';
import {
  ApplyPluginsType,
  ConfigChangeType,
  EnableBy,
  PluginType,
  ServiceStage,
} from './enums';
import getPaths from './getPaths';
import PluginAPI from './PluginAPI';
import { ICommand, IHook, IPackage, IPlugin, IPreset } from './types';
import isPromise from './utils/isPromise';
import loadDotEnv from './utils/loadDotEnv';
import { pathToObj, resolvePlugins, resolvePresets } from './utils/pluginUtils';

const logger = new Logger('umi:core:Service'); // console.log方式输出信息的方法实例

export interface IServiceOpts {
  cwd: string;
  pkg?: IPackage;
  presets?: string[];
  plugins?: string[];
  configFiles?: string[];
  env?: NodeEnv;
}

interface IConfig {
  presets?: string[];
  plugins?: string[];
  [key: string]: any;
}

// TODO
// 1. duplicated key
// 这个类继承于EventEmitter，可以发事件或者监听事件等等
export default class Service extends EventEmitter {
  // class上面的属性只是赋值一个初始值，具体的赋值逻辑在constructor中实现
  cwd: string; // 当前工作目录
  pkg: IPackage; // package.json的对象形式
  skipPluginIds: Set<string> = new Set<string>(); // 跳过的插件id
  // lifecycle stage
  stage: ServiceStage = ServiceStage.uninitialized; // 当前的service实例所处的生命周期
  // registered commands
  commands: {
    // 注册了的命令
    [name: string]: ICommand | string;
  } = {};
  // including presets and plugins
  plugins: {
    // 预设和插件
    [id: string]: IPlugin;
  } = {};
  // plugin methods
  pluginMethods: {
    [name: string]: Function;
  } = {};
  // initial presets and plugins from arguments, config, process.env, and package.json
  initialPresets: IPreset[];
  initialPlugins: IPlugin[];
  // presets and plugins for registering
  // 还没用，等待被注册的预设和插件
  _extraPresets: IPreset[] = [];
  _extraPlugins: IPlugin[] = [];
  // user config
  userConfig: IConfig; // 用户配置
  configInstance: Config; // 配置实例
  config: IConfig | null = null; // 插件配置
  // babel register
  babelRegister: BabelRegister;
  // hooks
  hooksByPluginId: {
    [id: string]: IHook[];
  } = {};
  hooks: {
    [key: string]: IHook[];
  } = {};
  // paths
  // 所有路径的收集
  paths: {
    cwd?: string;
    absNodeModulesPath?: string;
    absSrcPath?: string;
    absPagesPath?: string;
    absOutputPath?: string;
    absTmpPath?: string;
  } = {};
  // process.env.NODE_ENV
  // umi build 就是 production
  // umi start 就是 development
  env: string | undefined;
  // 存储一些常量
  ApplyPluginsType = ApplyPluginsType;
  EnableBy = EnableBy;
  ConfigChangeType = ConfigChangeType;
  ServiceStage = ServiceStage;
  args: any;

  constructor(opts: IServiceOpts) {
    super(); // 继承EventEmitter，实现父类的constructor

    logger.debug('opts:');
    logger.debug(opts);
    this.cwd = opts.cwd || process.cwd(); // 属性赋值当前路径
    // repoDir should be the root dir of repo
    this.pkg = opts.pkg || this.resolvePackage(); // 赋值package.json文件
    this.env = opts.env || process.env.NODE_ENV; // 赋值env dev或者production

    // 断言函数，如果existsSync(this.cwd)为false,就抛出一个错误，该错误的提示信息就是第二个参数设定的字符串
    assert(existsSync(this.cwd), `cwd ${this.cwd} does not exist.`);

    // register babel before config parsing
    this.babelRegister = new BabelRegister();

    // load .env or .local.env
    logger.debug('load env');
    // 通过.env或者是.local.env文件加载环境,
    this.loadEnv();

    // get user config without validation
    logger.debug('get user config');
    const configFiles = opts.configFiles; // 可以传入配置文件

    // get user config without validation
    // 创建 Config 对象，获得 userConfig
    // Config 也是 umi 中非常重要的一个类，负责 umi 配置文件的解析
    this.configInstance = new Config({
      // 通过传入的配置文件生成管理配置的实例
      cwd: this.cwd,
      service: this,
      localConfig: this.env === 'development',
      configFiles:
        Array.isArray(configFiles) && !!configFiles[0]
          ? configFiles
          : undefined,
    });

    // userConfig 获得配置文件(.umirc.ts 等) export 的对象
    this.userConfig = this.configInstance.getUserConfig(); // 获取用户自定义配置
    logger.debug('userConfig:');
    logger.debug(this.userConfig);

    // userConfig 中我们配置了一些路径，这里通过 userConfig 中的配置计算路径。
    // 比如 userConfig.outputPath 配置了输出文件路径，默认是 dist
    // 收集所需要的不同文件的绝对路径
    this.paths = getPaths({
      cwd: this.cwd,
      config: this.userConfig!,
      env: this.env,
    });
    logger.debug('paths:');
    logger.debug(this.paths);

    // setup initial presets and plugins
    const baseOpts = {
      pkg: this.pkg,
      cwd: this.cwd,
    };

    // 初始化 Presets, 来源于四处
    // 1. 构造 Service 传参
    // 2. process.env 中指定
    // 3. package.json 中 devDependencies 指定
    // 4. 用户在 .umirc.ts 文件中配置。
    this.initialPresets = resolvePresets({
      ...baseOpts,
      presets: opts.presets || [],
      userConfigPresets: this.userConfig.presets || [],
    });
    // 提取plugin给initialPresets，处理方式和presets一样
    this.initialPlugins = resolvePlugins({
      ...baseOpts,
      plugins: opts.plugins || [],
      userConfigPlugins: this.userConfig.plugins || [],
    });
    // initialPresets 和 initialPlugins 放入 babelRegister 中
    this.babelRegister.setOnlyMap({
      key: 'initialPlugins',
      value: lodash.uniq([
        ...this.initialPresets.map(({ path }) => path),
        ...this.initialPlugins.map(({ path }) => path),
      ]),
    });
    logger.debug('initial presets:');
    logger.debug(this.initialPresets);
    logger.debug('initial plugins:');
    logger.debug(this.initialPlugins);
  }

  setStage(stage: ServiceStage) {
    this.stage = stage;
  }

  // 获取根目录的package.json
  resolvePackage() {
    try {
      return require(join(this.cwd, 'package.json'));
    } catch (e) {
      return {};
    }
  }

  // 加载配置环境到process.env
  loadEnv() {
    const basePath = join(this.cwd, '.env'); //获取根目录下的.env文件路径
    const localPath = `${basePath}.local`; //获取根目录下的.env.local文件路径
    loadDotEnv(localPath); // 从.env.local文件加载环境变量加入process.env中
    loadDotEnv(basePath); // 从.env文件加载环境变量加入process.env中，所以.env文件优先级大雨.env.local文件
  }

  async init() {
    this.setStage(ServiceStage.init); // 设置生命周期为init
    // we should have the final hooksByPluginId which is added with api.register()
    await this.initPresetsAndPlugins(); // 初始化prestes和plugins

    // collect false configs, then add to this.skipPluginIds
    // skipPluginIds include two parts:
    // 1. api.skipPlugins()
    // 2. user config with the `false` value
    // Object.keys(this.hooksByPluginId).forEach(pluginId => {
    //   const { key } = this.plugins[pluginId];
    //   if (this.getPluginOptsWithKey(key) === false) {
    //     this.skipPluginIds.add(pluginId);
    //   }
    // });

    // delete hooks from this.hooksByPluginId with this.skipPluginIds
    // for (const pluginId of this.skipPluginIds) {
    //   if (this.hooksByPluginId[pluginId]) delete this.hooksByPluginId[pluginId];
    //   delete this.plugins[pluginId];
    // }

    // hooksByPluginId -> hooks
    // hooks is mapped with hook key, prepared for applyPlugins()
    this.setStage(ServiceStage.initHooks); // 生命周期到initHooks
    // 把hooksByPluginId中的信息提取到hooks中，本来是用pluginId分类的hook，现在按照key分类hooks
    Object.keys(this.hooksByPluginId).forEach((id) => {
      const hooks = this.hooksByPluginId[id];
      hooks.forEach((hook) => {
        const { key } = hook;
        hook.pluginId = id;
        this.hooks[key] = (this.hooks[key] || []).concat(hook);
      });
    });

    // plugin is totally ready
    this.setStage(ServiceStage.pluginReady);
    await this.applyPlugins({
      key: 'onPluginReady',
      type: ApplyPluginsType.event,
    });

    // get config, including:
    // 1. merge default config
    // 2. validate
    this.setStage(ServiceStage.getConfig);
    const defaultConfig = await this.applyPlugins({
      key: 'modifyDefaultConfig',
      type: this.ApplyPluginsType.modify,
      initialValue: await this.configInstance.getDefaultConfig(),
    });
    this.config = await this.applyPlugins({
      key: 'modifyConfig',
      type: this.ApplyPluginsType.modify,
      initialValue: this.configInstance.getConfig({
        defaultConfig,
      }) as any,
    });

    // merge paths to keep the this.paths ref
    this.setStage(ServiceStage.getPaths);
    // config.outputPath may be modified by plugins
    if (this.config!.outputPath) {
      this.paths.absOutputPath = join(this.cwd, this.config!.outputPath);
    }
    const paths = (await this.applyPlugins({
      key: 'modifyPaths',
      type: ApplyPluginsType.modify,
      initialValue: this.paths,
    })) as object;
    Object.keys(paths).forEach((key) => {
      this.paths[key] = paths[key];
    });
  }

  // 初始化presets和插件
  async initPresetsAndPlugins() {
    this.setStage(ServiceStage.initPresets); // 设置为initpresets生命周期
    this._extraPlugins = [];
    // 把initialPresets中的preset从前到后依次init
    while (this.initialPresets.length) {
      await this.initPreset(this.initialPresets.shift()!);
    }

    this.setStage(ServiceStage.initPlugins);
    // 把initialPlugins放到_extraPlugins最后
    this._extraPlugins.push(...this.initialPlugins);
    // _extraPlugins从前向后依次init
    while (this._extraPlugins.length) {
      await this.initPlugin(this._extraPlugins.shift()!);
    }
  }

  getPluginAPI(opts: any) {
    const pluginAPI = new PluginAPI(opts); // 生成插件API实例

    // register built-in methods
    // 注册这些固有的方法
    [
      'onPluginReady',
      'modifyPaths',
      'onStart',
      'modifyDefaultConfig',
      'modifyConfig',
    ].forEach((name) => {
      pluginAPI.registerMethod({ name, exitsError: false });
    });

    return new Proxy(pluginAPI, {
      // target:目标对象，property: 被获取的属性名
      get: (target, prop: string) => {
        // 由于 pluginMethods 需要在 register 阶段可用
        // 必须通过 proxy 的方式动态获取最新，以实现边注册边使用的效果
        // 如果这个方法prop已经被注册了就直接返回执行的结果，注意这个thisy腻味汁箭头函数指向的是service实例
        if (this.pluginMethods[prop]) return this.pluginMethods[prop];
        if (
          [
            'applyPlugins',
            'ApplyPluginsType',
            'EnableBy',
            'ConfigChangeType',
            'babelRegister',
            'stage',
            'ServiceStage',
            'paths',
            'cwd',
            'pkg',
            'userConfig',
            'config',
            'env',
            'args',
            'hasPlugins',
            'hasPresets',
          ].includes(prop)
        ) {
          return typeof this[prop] === 'function'
            ? this[prop].bind(this)
            : this[prop];
        }
        return target[prop];
      },
    });
  }

  async applyAPI(opts: { apply: Function; api: PluginAPI }) {
    // opts.apply就是在utils/pluginUtils中定义的pathToObj方法中返回的apply函数
    // 执行了apply方法后的返回值是插件的export出的函数，这个函数的返回值是一个对象，其中包含了插件中有的presets,plugins的路径信息，入参是api这个plugin对象，可以通过这个对象去访问service上注册的方法
    let ret = opts.apply()(opts.api);
    if (isPromise(ret)) {
      ret = await ret;
    }
    return ret || {};
  }

  async initPreset(preset: IPreset) {
    const { id, key, apply } = preset; // 从preset的描述对象中取出要的部分
    preset.isPreset = true; // 加上一个isPreset为true的属性

    // 获取插件api
    const api = this.getPluginAPI({ id, key, service: this }); // 传入插件的id,key和service去换取插件的api

    // register before apply
    // 在this.plugins上建立id到IPreset的映射关系
    this.registerPlugin(preset);
    // TODO: ...defaultConfigs 考虑要不要支持，可能这个需求可以通过其他渠道实现
    const { presets, plugins, ...defaultConfigs } = await this.applyAPI({
      api,
      apply,
    });

    // register extra presets and plugins
    if (presets) {
      assert(
        Array.isArray(presets),
        `presets returned from preset ${id} must be Array.`,
      );
      // 插到最前面，下个 while 循环优先执行
      this._extraPresets.splice(
        0,
        0,
        ...presets.map((path: string) => {
          return pathToObj({
            type: PluginType.preset,
            path,
            cwd: this.cwd,
          });
        }),
      );
    }

    // 深度优先
    const extraPresets = lodash.clone(this._extraPresets);
    this._extraPresets = [];
    while (extraPresets.length) {
      await this.initPreset(extraPresets.shift()!);
    }

    if (plugins) {
      assert(
        Array.isArray(plugins),
        `plugins returned from preset ${id} must be Array.`,
      );
      this._extraPlugins.push(
        ...plugins.map((path: string) => {
          return pathToObj({
            type: PluginType.plugin,
            path,
            cwd: this.cwd,
          });
        }),
      );
    }
  }

  async initPlugin(plugin: IPlugin) {
    const { id, key, apply } = plugin;

    const api = this.getPluginAPI({ id, key, service: this });

    // register before apply
    this.registerPlugin(plugin);
    await this.applyAPI({ api, apply });
  }

  getPluginOptsWithKey(key: string) {
    return getUserConfigWithKey({
      key,
      userConfig: this.userConfig,
    });
  }

  registerPlugin(plugin: IPlugin) {
    // 考虑要不要去掉这里的校验逻辑
    // 理论上不会走到这里，因为在 describe 的时候已经做了冲突校验
    if (this.plugins[plugin.id]) {
      const name = plugin.isPreset ? 'preset' : 'plugin';
      throw new Error(`\
${name} ${plugin.id} is already registered by ${this.plugins[plugin.id].path}, \
${name} from ${plugin.path} register failed.`);
    }
    this.plugins[plugin.id] = plugin;
  }

  isPluginEnable(pluginId: string) {
    // api.skipPlugins() 的插件
    if (this.skipPluginIds.has(pluginId)) return false;

    const { key, enableBy } = this.plugins[pluginId];

    // 手动设置为 false
    if (this.userConfig[key] === false) return false;

    // 配置开启
    if (enableBy === this.EnableBy.config && !(key in this.userConfig)) {
      return false;
    }

    // 函数自定义开启
    if (typeof enableBy === 'function') {
      return enableBy();
    }

    // 注册开启
    return true;
  }

  hasPlugins(pluginIds: string[]) {
    return pluginIds.every((pluginId) => {
      const plugin = this.plugins[pluginId];
      return plugin && !plugin.isPreset && this.isPluginEnable(pluginId);
    });
  }

  hasPresets(presetIds: string[]) {
    return presetIds.every((presetId) => {
      const preset = this.plugins[presetId];
      return preset && preset.isPreset && this.isPluginEnable(presetId);
    });
  }

  async applyPlugins(opts: {
    key: string; // hook的key,一个key对应多个hook
    type: ApplyPluginsType; // 应用插件的类型
    initialValue?: any; // 使用插件的初始值
    args?: any; // hook的fn的参数，即使用插件的回调函数的参数
  }) {
    const hooks = this.hooks[opts.key] || []; // 获取有同样key的所有hook
    switch (opts.type) {
      case ApplyPluginsType.add:
        // 如果有initialValue,这个值必须为数组
        if ('initialValue' in opts) {
          assert(
            Array.isArray(opts.initialValue),
            `applyPlugins failed, opts.initialValue must be Array if opts.type is add.`,
          );
        }
        // 新建一个hook,参数为memo,tapable提供的hook,一个key对应了一个tapable的hook
        const tAdd = new AsyncSeriesWaterfallHook(['memo']);
        for (const hook of hooks) {
          // 如果插件不可用就不管
          if (!this.isPluginEnable(hook.pluginId!)) {
            continue;
          }
          // 注册这个hook到对应实例上
          tAdd.tapPromise(
            {
              name: hook.pluginId!,
              stage: hook.stage || 0,
              // @ts-ignore
              before: hook.before,
            },
            async (memo: any[]) => {
              // 回调函数中执行了hook中的fn并且传入了opts.args参数
              const items = await hook.fn(opts.args);
              return memo.concat(items);
            },
          );
        }
        // 返回执行这个tAdd钩子实例的promise实例
        return await tAdd.promise(opts.initialValue || []);
      case ApplyPluginsType.modify:
        const tModify = new AsyncSeriesWaterfallHook(['memo']);
        for (const hook of hooks) {
          if (!this.isPluginEnable(hook.pluginId!)) {
            continue;
          }
          tModify.tapPromise(
            {
              name: hook.pluginId!,
              stage: hook.stage || 0,
              // @ts-ignore
              before: hook.before,
            },
            async (memo: any) => {
              // mdify是把memo和args一起穿给了fn
              return await hook.fn(memo, opts.args);
            },
          );
        }
        return await tModify.promise(opts.initialValue);
      case ApplyPluginsType.event:
        const tEvent = new AsyncSeriesWaterfallHook(['_']);
        for (const hook of hooks) {
          if (!this.isPluginEnable(hook.pluginId!)) {
            continue;
          }
          tEvent.tapPromise(
            {
              name: hook.pluginId!,
              stage: hook.stage || 0,
              // @ts-ignore
              before: hook.before,
            },
            async () => {
              await hook.fn(opts.args);
            },
          );
        }
        // event方式直接就用promise调用，不需要传参数
        return await tEvent.promise();
      default:
        throw new Error(
          `applyPlugin failed, type is not defined or is not matched, got ${opts.type}.`,
        );
    }
  }

  // name和args在外层的命令行获取传入
  async run({ name, args = {} }: { name: string; args?: any }) {
    // name为环境变量，args为参数
    args._ = args._ || [];
    // shift the command itself
    if (args._[0] === name) args._.shift();

    this.args = args;
    await this.init();

    logger.debug('plugins:');
    logger.debug(this.plugins);

    this.setStage(ServiceStage.run); // 设置生命周期到run阶段
    await this.applyPlugins({
      // 应用插件
      key: 'onStart',
      type: ApplyPluginsType.event,
      args: {
        name,
        args,
      },
    });
    return this.runCommand({ name, args }); // 执行
  }

  // 外层获取传入
  async runCommand({ name, args = {} }: { name: string; args?: any }) {
    assert(this.stage >= ServiceStage.init, `service is not initialized.`);

    args._ = args._ || [];
    // shift the command itself
    if (args._[0] === name) args._.shift();

    const command =
      typeof this.commands[name] === 'string'
        ? this.commands[this.commands[name] as string]
        : this.commands[name];
    assert(command, `run command failed, command ${name} does not exists.`);

    const { fn } = command as ICommand;
    return fn({ args });
  }
}
