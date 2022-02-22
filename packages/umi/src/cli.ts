import { chalk, yParser } from '@umijs/utils';
import { existsSync } from 'fs';
import { join } from 'path';
import initWebpack from './initWebpack';
import { Service } from './ServiceWithBuiltIn';
import fork from './utils/fork';
import getCwd from './utils/getCwd';
import getPkg from './utils/getPkg';

const v = process.version; // node版本

if (v && parseInt(v.slice(1)) < 10) {
  // 版本至少10
  console.log(
    chalk.red(
      `Your node ${v} is not supported by umi, please upgrade to 10 or above.`,
    ),
  );
  process.exit(1);
}

// process.argv: [node, umi.js, command, args]
const args = yParser(process.argv.slice(2), {
  alias: {
    // 如果有key为version的属性新建一个v属性和这个version有一样的value
    version: ['v'],
    help: ['h'],
  },
  boolean: ['version'], // 把version这个键值变为boolean值
});

if (args.version && !args._[0]) {
  args._[0] = 'version';
  const local = existsSync(join(__dirname, '../.local'))
    ? chalk.cyan('@local')
    : '';
  console.log(`umi@${require('../package.json').version}${local}`);
} else if (!args._[0]) {
  // 如果没有 version 字段，args._ 中也没有值，认为要执行 help 命令。
  args._[0] = 'help';
}

// allow parent framework to modify the title
if (process.title === 'node') {
  process.title = 'umi';
}

(async () => {
  try {
    switch (args._[0]) {
      case 'dev': // 如果是命令行说是开发环境
        // fork是对原生fork方法的封装，通过进程间的通信加入了对端口的启动控制和重启的机制,
        const child = fork({
          // 新建一个子进程来执行forkedDev
          scriptPath: require.resolve('./forkedDev'), // require.resolve不执行这个模块，只会返回绝对路径
        });
        // ref:
        // http://nodejs.cn/api/process/signal_events.html
        // https://lisk.io/blog/development/why-we-stopped-using-npm-start-child-processes
        // 当前进程监听SIGINT事件就停止
        process.on('SIGINT', () => {
          // SIGINT事件对应按键盘的ctrl + c
          child.kill('SIGINT');
          // ref:
          // https://github.com/umijs/umi/issues/6009
          process.exit(0);
        });
        // 当前进程监听SIGTERM事件也停止
        process.on('SIGTERM', () => {
          child.kill('SIGTERM');
          process.exit(1);
        });
        break;
      default:
        const name = args._[0];
        if (name === 'build') {
          process.env.NODE_ENV = 'production';
        }

        // 如果是生产环境直接initWebpack，
        // Init webpack version determination and require hook for build command
        initWebpack();

        // service
        await new Service({
          cwd: getCwd(),
          pkg: getPkg(process.cwd()),
        }).run({
          name,
          args,
        });
        break;
    }
  } catch (e) {
    console.error(chalk.red(e.message));
    console.error(e.stack);
    process.exit(1);
  }
})();
