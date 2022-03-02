import * as utils from '@umijs/utils';
import assert from 'assert';
import Html from '../Html/Html';
import Logger from '../Logger/Logger';
import { EnableBy, PluginType, ServiceStage } from './enums';
import Service from './Service';
import { ICommand, IHook, IPlugin, IPluginConfig, IPreset } from './types';
import { isValidPlugin, pathToObj } from './utils/pluginUtils';

interface IOpts {
  id: string;
  key: string;
  service: Service;
}

export default class PluginAPI {
  id: string; // 描述插件的信息类中的id
  key: string;
  service: Service;
  Html: typeof Html; // Html类，暂时不看
  utils: typeof utils;
  logger: Logger;

  constructor(opts: IOpts) {
    this.id = opts.id;
    this.key = opts.key;
    this.service = opts.service;
    this.utils = utils;
    this.Html = Html;
    this.logger = new Logger(`umi:plugin:${this.id || this.key}`);
  }

  // TODO: reversed keys
  describe({
    id,
    key,
    config,
    enableBy,
  }: {
    id?: string;
    key?: string;
    config?: IPluginConfig;
    onChange?: any;
    enableBy?: EnableBy | (() => boolean);
  } = {}) {
    const { plugins } = this.service;
    // this.id and this.key is generated automatically
    // so we need to diff first
    if (id && this.id !== id) {
      if (plugins[id]) {
        const name = plugins[id].isPreset ? 'preset' : 'plugin';
        throw new Error(
          `api.describe() failed, ${name} ${id} is already registered by ${plugins[id].path}.`,
        );
      }
      plugins[id] = plugins[this.id];
      plugins[id].id = id;
      delete plugins[this.id];
      this.id = id;
    }
    if (key && this.key !== key) {
      this.key = key;
      plugins[this.id].key = key;
    }

    if (config) {
      plugins[this.id].config = config;
    }

    plugins[this.id].enableBy = enableBy || EnableBy.register;
  }

  // 使用pluginId分类的注册方法，注册到service实例
  register(hook: IHook) {
    // 首先先判断hook的格式是否正确
    assert(
      hook.key && typeof hook.key === 'string',
      `api.register() failed, hook.key must supplied and should be string, but got ${hook.key}.`,
    );
    assert(
      hook.fn && typeof hook.fn === 'function',
      `api.register() failed, hook.fn must supplied and should be function, but got ${hook.fn}.`,
    );
    // hooksByPluginId 就是指被pluginId所分类的hooks
    // 所以注册的过程其实就是把一个plugin的hook放到hooksByPluginId中
    this.service.hooksByPluginId[this.id] = (
      this.service.hooksByPluginId[this.id] || []
    ).concat(hook);
  }

  // 注册把命令注册到service实例上
  registerCommand(command: ICommand) {
    const { name, alias } = command;
    assert(
      !this.service.commands[name],
      `api.registerCommand() failed, the command ${name} is exists.`,
    );
    this.service.commands[name] = command;
    if (alias) {
      this.service.commands[alias] = name;
    }
  }

  // 把presets注册到service实例的_extraPresets上，并放到最前面优先执行
  registerPresets(presets: (IPreset | string)[]) {
    // 只有在initPresets阶段才可以执行这个方法
    assert(
      this.service.stage === ServiceStage.initPresets,
      `api.registerPresets() failed, it should only used in presets.`,
    );
    assert(
      Array.isArray(presets),
      `api.registerPresets() failed, presets must be Array.`,
    );
    // 看下传入的presets是不是信息对象，如果不是的话就转换成信息对象
    const extraPresets = presets.map((preset) => {
      return isValidPlugin(preset as any)
        ? (preset as IPreset)
        : pathToObj({
            type: PluginType.preset,
            path: preset as string,
            cwd: this.service.cwd,
          });
    });
    // 插到_extraPresets最前面，下个 while 循环优先执行
    this.service._extraPresets.splice(0, 0, ...extraPresets);
  }

  // 同注册presets
  registerPlugins(plugins: (IPlugin | string)[]) {
    assert(
      this.service.stage === ServiceStage.initPresets ||
        this.service.stage === ServiceStage.initPlugins,
      `api.registerPlugins() failed, it should only be used in registering stage.`,
    );
    assert(
      Array.isArray(plugins),
      `api.registerPlugins() failed, plugins must be Array.`,
    );
    const extraPlugins = plugins.map((plugin) => {
      return isValidPlugin(plugin as any)
        ? (plugin as IPreset)
        : pathToObj({
            type: PluginType.plugin,
            path: plugin as string,
            cwd: this.service.cwd,
          });
    });
    if (this.service.stage === ServiceStage.initPresets) {
      this.service._extraPlugins.push(...extraPlugins);
    } else {
      this.service._extraPlugins.splice(0, 0, ...extraPlugins);
    }
  }

  // 注册方法,放在service实例的pluginMethods上
  registerMethod({
    name,
    fn,
    exitsError = true,
  }: {
    name: string;
    fn?: Function;
    exitsError?: boolean;
  }) {
    if (this.service.pluginMethods[name]) {
      // 如果已经存在了，即如果已经注册过了这个方法就直接返回
      if (exitsError) {
        // 如果还传入了错误就直接报错
        throw new Error(
          `api.registerMethod() failed, method ${name} is already exist.`,
        );
      } else {
        return;
      }
    }
    // 如果传入了注册的方法fn就用这个
    this.service.pluginMethods[name] =
      fn ||
      // 这里不能用 arrow function，this 需指向执行此方法的 PluginAPI
      // 否则 pluginId 会不会，导致不能正确 skip plugin
      function (fn: Function | Object) {
        // 否则自己传入一个用于注册hook的函数
        const hook = {
          key: name,
          ...(utils.lodash.isPlainObject(fn) ? fn : { fn }),
        };
        // @ts-ignore
        this.register(hook);
      };
  }

  skipPlugins(pluginIds: string[]) {
    pluginIds.forEach((pluginId) => {
      this.service.skipPluginIds.add(pluginId);
    });
  }
}
