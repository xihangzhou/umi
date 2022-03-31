import { IApi } from '@umijs/types';
import { chokidar, lodash, winPath } from '@umijs/utils';
import { join } from 'path';

// watch参数是否监听
export default async ({ api, watch }: { api: IApi; watch?: boolean }) => {
  const { paths } = api;

  async function generate(files?: { event: string; path: string }[]) {
    api.logger.debug('generate files', files);
    await api.applyPlugins({
      key: 'onGenerateFiles',
      type: api.ApplyPluginsType.event,
      args: {
        files: files || [],
      },
    });
  }

  const watchers: chokidar.FSWatcher[] = [];

  // generate方法掉用onGenerateFiles周期，去生成对应的这些.umi下的文件
  await generate();

  // 再通过watch参数判断是否需要监听如下的文件的变动，如果需要监听的话就需要创建watch去监听这些文件的变化，如果有变化就要重新生成对应的.umi临时文件
  // 这些文件的具体作用可以看官网
  if (watch) {
    // 掉用addTmpGenerateWatcherPaths生命周期，如果没有注册hooks就直接返回初始的initialValue
    const watcherPaths = await api.applyPlugins({
      key: 'addTmpGenerateWatcherPaths',
      type: api.ApplyPluginsType.add,
      initialValue: [
        paths.absPagesPath!,
        join(paths.absSrcPath!, api.config?.singular ? 'layout' : 'layouts'),
        join(paths.absSrcPath!, 'app.tsx'),
        join(paths.absSrcPath!, 'app.ts'),
        join(paths.absSrcPath!, 'app.jsx'),
        join(paths.absSrcPath!, 'app.js'),
      ],
    });
    // 对不重复的路径生成watcher
    lodash
      .uniq<string>(watcherPaths.map((p: string) => winPath(p)))
      .forEach((p: string) => {
        createWatcher(p);
      });
    // process.on('SIGINT', () => {
    //   console.log('SIGINT');
    //   unwatch();
    // });
  }

  function unwatch() {
    watchers.forEach((watcher) => {
      watcher.close();
    });
  }

  function createWatcher(path: string) {
    const watcher = chokidar.watch(path, {
      // ignore .dotfiles and _mock.js
      ignored: /(^|[\/\\])(_mock.js$|\..)/,
      ignoreInitial: true,
    });
    let timer: any = null;
    let files: { event: string; path: string }[] = [];
    watcher.on('all', (event: string, path: string) => {
      if (timer) {
        clearTimeout(timer);
      }
      files.push({ event, path: winPath(path) });
      timer = setTimeout(async () => {
        timer = null;
        await generate(files);
        files = [];
      }, 2000);
    });
    watchers.push(watcher);
  }

  return unwatch;
};
