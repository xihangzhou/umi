import { chalk, yParser } from '@umijs/utils';
import initWebpack from './initWebpack';
import { Service } from './ServiceWithBuiltIn';
import getCwd from './utils/getCwd'; // 获取当前进程的工作目录
import getPkg from './utils/getPkg';

const args = yParser(process.argv.slice(2));

(async () => {
  try {
    process.env.NODE_ENV = 'development'; // env中的环境变量设置为development
    // 初始化webpack之后再来看看
    // Init webpack version determination and require hook
    initWebpack();

    // Service类是CoreService的补充，具体再看
    const service = new Service({
      cwd: getCwd(), // 获取当前process中的APP_ROOT的绝对目录，即任务进行的目录
      pkg: getPkg(process.cwd()), // 获取这个目录下的package.json的位置
    });

    // 开启服务
    await service.run({
      name: 'dev',
      args,
    });

    let closed = false;
    // kill(2) Ctrl-C
    process.once('SIGINT', () => onSignal('SIGINT'));
    // kill(3) Ctrl-\
    process.once('SIGQUIT', () => onSignal('SIGQUIT'));
    // kill(15) default
    process.once('SIGTERM', () => onSignal('SIGTERM'));

    function onSignal(signal: string) {
      if (closed) return; // 防止连续触发多次
      closed = true;

      // 退出时触发插件中的onExit事件
      service.applyPlugins({
        key: 'onExit',
        type: service.ApplyPluginsType.event,
        args: {
          signal,
        },
      });
      process.exit(0);
    }
  } catch (e) {
    console.error(chalk.red(e.message));
    console.error(e.stack);
    process.exit(1);
  }
})();
