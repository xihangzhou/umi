import { fork } from 'child_process';

const usedPorts: number[] = [];
let CURRENT_PORT: number | undefined;

interface IOpts {
  scriptPath: string;
}

export default function start({ scriptPath }: IOpts) {
  const execArgv = process.execArgv.slice(0); // process.execArgv 属性返回 Node.js 进程启动时传入的一组特定于 Node.js 的命令行选项。
  const inspectArgvIndex = execArgv.findIndex(
    (
      argv, // 找到--inspect-brk选项的下标，--inspect-brk下标是运行node的时候的调试的下标，可以指定和调试器的链接端口号
    ) => argv.includes('--inspect-brk'),
  );

  // 如果有这个选项就去检验一下端口是否被占用，要是被占用了就找个没被占用的
  if (inspectArgvIndex > -1) {
    const inspectArgv = execArgv[inspectArgvIndex];
    execArgv.splice(
      inspectArgvIndex,
      1,
      inspectArgv.replace(/--inspect-brk=(.*)/, (match, s1) => {
        let port;
        try {
          port = parseInt(s1) + 1;
        } catch (e) {
          port = 9230; // node default inspect port plus 1.
        }
        if (usedPorts.includes(port)) {
          port += 1;
        }
        usedPorts.push(port);
        return `--inspect-brk=${port}`;
      }),
    );
  }

  // set port to env when current port has value
  if (CURRENT_PORT) {
    // @ts-ignore
    process.env.PORT = CURRENT_PORT;
  }

  // 采用原生的fork方法开启一个新的子进程，并且这个子进程是可以和父进程通信的
  const child = fork(scriptPath, process.argv.slice(2), { execArgv });

  // 子进程监听父进程的message事件
  child.on('message', (data: any) => {
    const type = (data && data.type) || null;
    if (type === 'RESTART') {
      // 如果type是RESTART就重启
      child.kill();
      start({ scriptPath });
    } else if (type === 'UPDATE_PORT') {
      // 更新port
      // set current used port
      CURRENT_PORT = data.port as number;
    }
    process.send?.(data); // 将data发回给父进程
  });

  return child;
}
