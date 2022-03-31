import { IApi } from '@umijs/types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runtimePath } from '../constants';

export default function (api: IApi) {
  const {
    utils: { Mustache, lodash },
  } = api; // 这里的utils是在pluginAPI实例new的时候挂载上的

  api.describe({
    // 调用描述方法，给PluginAPI实例加上key为history,并且在this.service.plugins[id].config中加入config描述对象用于描述这个插件
    key: 'history',
    config: {
      default: { type: 'browser' },
      schema(joi) {
        // https://joi.dev/api/?v=17.6.0
        // joi是一个json schema的实现方式
        const type = joi.string().valid('browser', 'hash', 'memory').required(); // type property的schma
        // 这个schema有两个properties，一个是type，另外一个是options
        return joi.object({
          type,
          options: joi.object(),
        });
      },
      onChange: api.ConfigChangeType.regenerateTmpFiles,
    },
  });

  // 调用onGenerateFiles方法把这个匿名函数作为一个hook注册在service实例上，这个hook的key就为onGenerateFiles
  api.onGenerateFiles(async () => {
    const historyTpl = readFileSync(
      // 根据配置运行环境读取不同的模版文件
      join(
        __dirname,
        // @ts-ignore
        api.config.runtimeHistory
          ? 'history.runtime.tpl'
          : api.config.history === false
          ? 'history.sham.tpl'
          : 'history.tpl',
      ),
      'utf-8',
    );
    const history = api.config.history!; // api.config是在运行了modifyConfig过后的返回值，放在service实例下

    // history 不可能为 false，这里是为了 ts 编译
    if (!history) return;

    const { type, options = {} } = history;

    api.writeTmpFile({
      path: 'core/history.ts',
      content: Mustache.render(historyTpl, {
        // Mustache模版语法，把下面的creator，options，runtimePath变量在模版中进行对应的替换
        creator: `create${lodash.upperFirst(type)}History`,
        options: JSON.stringify(
          {
            ...options,
            ...(type === 'browser' || type === 'hash'
              ? { basename: api.config.base }
              : {}),
          },
          null,
          2,
        ),
        runtimePath,
      }),
    });
  });

  // 同理把这个匿名函数作为一个hook注册在service实例上，这个hook的key就为addUmiExports
  api.addUmiExports(() => {
    // @ts-ignore
    if (api.config.history === false) return [];

    if (api.config.runtimeHistory) {
      return {
        specifiers: [
          'history',
          'setCreateHistoryOptions',
          'getCreateHistoryOptions',
        ],
        source: `./history`,
      };
    }

    return {
      specifiers: ['history'],
      source: `./history`,
    };
  });
}
