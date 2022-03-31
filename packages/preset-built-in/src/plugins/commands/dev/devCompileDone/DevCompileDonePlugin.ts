import { webpack } from '@umijs/types';
import { address, chalk, clipboardy } from '@umijs/utils';

interface IOpts {
  port: number;
  hostname: string;
  https?: boolean;
  onCompileDone: (args: {
    isFirstCompile: boolean;
    stats: webpack.Stats;
  }) => void;
  onCompileFail: (args: { stats: webpack.Stats }) => void;
}

export default class DevCompileDonePlugin {
  opts: IOpts;

  constructor(opts: IOpts) {
    this.opts = opts;
  }

  apply(compiler: webpack.Compiler) {
    let isFirstCompile = true;
    // 注册DevFirstCompileDone方法到webpack的done周期上，即在 compilation 完成时执行。
    compiler.hooks.done.tap('DevFirstCompileDone', (stats) => {
      if (stats.hasErrors()) {
        // make sound
        if (process.env.SYSTEM_BELL !== 'none') {
          process.stdout.write('\x07');
        }
        this.opts.onCompileFail?.({
          stats,
        });
        return;
      }

      // 如果是第一次编译完成的话给一些提示信息
      if (isFirstCompile) {
        const lanIp = address.ip();
        const protocol = this.opts.https ? 'https' : 'http';
        const hostname =
          this.opts.hostname === '0.0.0.0' ? 'localhost' : this.opts.hostname;
        const localUrl = `${protocol}://${hostname}:${this.opts.port}`;
        const lanUrl = `${protocol}://${lanIp}:${this.opts.port}`;

        let copied = '';
        try {
          clipboardy.writeSync(localUrl);
          copied = chalk.dim('(copied to clipboard)');
        } catch (e) {
          copied = chalk.red(`(copy to clipboard failed)`);
        }

        console.log();
        console.log(
          [
            `  App running at:`,
            `  - Local:   ${chalk.cyan(localUrl)} ${copied}`,
            lanUrl && `  - Network: ${chalk.cyan(lanUrl)}`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }

      // 调用传入的回调函数
      this.opts.onCompileDone?.({
        isFirstCompile,
        stats,
      });

      if (isFirstCompile) {
        isFirstCompile = false;
        process.send?.({ type: 'DONE' });
        // openBrowser();
      }
    });
  }
}
