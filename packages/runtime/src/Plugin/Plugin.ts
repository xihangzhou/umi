import { assert } from '../utils';

export enum ApplyPluginsType {
  compose = 'compose',
  modify = 'modify',
  event = 'event',
}

interface IPlugin {
  path?: string;
  apply: object;
}

interface IOpts {
  validKeys?: string[];
}

// 这个函数的作用就是对于一个函数数组，返回一个函数,这个函数在外面执行就会依次拿到入参
function _compose({ fns, args }: { fns: (Function | any)[]; args?: object }) {
  if (fns.length === 1) {
    return fns[0];
  }
  const last = fns.pop();
  return fns.reduce((a, b) => () => b(a, args), last);
}

function isPromiseLike(obj: any) {
  return !!obj && typeof obj === 'object' && typeof obj.then === 'function';
}

// 整个plugin其实就是在实现一个类似编译阶段的插件机制，只是没有用tapable而已。可以说自己实现了一个简单版本的tapable
export default class Plugin {
  validKeys: string[];
  hooks: {
    [key: string]: any;
  } = {};

  constructor(opts?: IOpts) {
    this.validKeys = opts?.validKeys || [];
  }

  // 注册hooks,即把hooks注册到对应的key上。注意和这个IPlugin不是Plugin的实例，而是外部用户传入的自定义Plugin
  register(plugin: IPlugin) {
    assert(!!plugin.apply, `register failed, plugin.apply must supplied`);
    assert(!!plugin.path, `register failed, plugin.path must supplied`);
    Object.keys(plugin.apply).forEach((key) => {
      assert(
        this.validKeys.indexOf(key) > -1,
        `register failed, invalid key ${key} from plugin ${plugin.path}.`,
      );
      if (!this.hooks[key]) this.hooks[key] = [];
      this.hooks[key] = this.hooks[key].concat(plugin.apply[key]);
    });
  }

  // 获取一个key对应的hooks
  getHooks(keyWithDot: string) {
    const [key, ...memberKeys] = keyWithDot.split('.');
    let hooks = this.hooks[key] || [];
    if (memberKeys.length) {
      hooks = hooks
        .map((hook: any) => {
          try {
            let ret = hook;
            for (const memberKey of memberKeys) {
              ret = ret[memberKey];
            }
            return ret;
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean); // 去掉隐式转换为false的
    }
    return hooks;
  }

  applyPlugins({
    key,
    type,
    initialValue,
    args,
    async,
  }: {
    key: string;
    type: ApplyPluginsType;
    initialValue?: any;
    args?: object;
    async?: boolean;
  }) {
    const hooks = this.getHooks(key) || [];

    if (args) {
      assert(
        typeof args === 'object',
        `applyPlugins failed, args must be plain object.`,
      );
    }

    switch (type) {
      case ApplyPluginsType.modify: // 按照顺序执行，参数要向下传递
        // 异步执行
        if (async) {
          return hooks.reduce(
            // hook有可能是Function,Promise,或者是一个对象
            async (memo: any, hook: Function | Promise<any> | object) => {
              assert(
                typeof hook === 'function' ||
                  typeof hook === 'object' ||
                  isPromiseLike(hook),
                `applyPlugins failed, all hooks for key ${key} must be function, plain object or Promise.`,
              );
              // 如果memo是一个promise,即之前的hook是还在等待执行完成的promise,就直接等前面的hookx执行完毕
              if (isPromiseLike(memo)) {
                memo = await memo;
              }
              // 如果hook是一个函数
              if (typeof hook === 'function') {
                const ret = hook(memo, args); // memo作为参数传入
                if (isPromiseLike(ret)) {
                  return await ret; // 如果函数的返回结果是一个promise，就返回这个promise实例
                } else {
                  return ret; // 否则直接返回函数的执行结果，并不带上memo
                }
              } else {
                // 如果是一个对象
                if (isPromiseLike(hook)) {
                  // 如果是一个promise实例
                  hook = await hook; // 就直接等待
                }
                // 最后把memo和hook的返回结果一起传递给下一个hook
                return { ...memo, ...hook };
              }
            },
            // 初始值如果不是promise的话用promise包装一下等待最后执行
            isPromiseLike(initialValue)
              ? initialValue
              : Promise.resolve(initialValue),
          );
        } else {
          // 同步执行
          return hooks.reduce((memo: any, hook: Function | object) => {
            assert(
              typeof hook === 'function' || typeof hook === 'object',
              `applyPlugins failed, all hooks for key ${key} must be function or plain object.`,
            );
            if (typeof hook === 'function') {
              return hook(memo, args);
            } else {
              // TODO: deepmerge?
              return { ...memo, ...hook };
            }
          }, initialValue);
        }

      case ApplyPluginsType.event: // 所有的hooks依次执行，参数不向下传递
        return hooks.forEach((hook: Function) => {
          assert(
            typeof hook === 'function',
            `applyPlugins failed, all hooks for key ${key} must be function.`,
          );
          hook(args);
        });

      case ApplyPluginsType.compose:
        return () => {
          return _compose({
            fns: hooks.concat(initialValue),
            args,
          })();
        };
    }
  }
}
