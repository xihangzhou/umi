import { isAbsolute, join } from 'path';

export default () => {
  let cwd = process.cwd(); // process.cwd() 方法返回 Node.js 进程的当前工作目录。 current work directory
  if (process.env.APP_ROOT) {
    // avoid repeat cwd path
    if (!isAbsolute(process.env.APP_ROOT)) {
      return join(cwd, process.env.APP_ROOT);
    }
    return process.env.APP_ROOT;
  }
  return cwd;
};
