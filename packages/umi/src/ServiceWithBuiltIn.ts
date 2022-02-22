import { IServiceOpts, Service as CoreService } from '@umijs/core';
import { dirname } from 'path';

// 从核心的CoreService延伸的一个类
class Service extends CoreService {
  constructor(opts: IServiceOpts) {
    process.env.UMI_VERSION = require('../package').version; // 获取package.json文件中的version版本存入env.UMI_VERSION
    process.env.UMI_DIR = dirname(require.resolve('../package')); // 获取package.json文件的绝对路径

    super({
      // 调用父类的constructor，opts中的值都传给CoreService并且传入预设和插件umiAlias
      ...opts,
      presets: [
        // 预设值传入@umijs/preset-built-in
        require.resolve('@umijs/preset-built-in'),
        ...(opts.presets || []),
      ],
      plugins: [require.resolve('./plugins/umiAlias'), ...(opts.plugins || [])], // 传入外层的插件umiAlias，该插件修改 webpack 配置中的 alias
    });
  }
}

export { Service };
