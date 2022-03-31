import { IApi, IRoute, webpack } from '@umijs/types';
import { lodash } from '@umijs/utils';
import assert from 'assert';
import { existsSync } from 'fs';
import { extname, join } from 'path';

interface IGetContentArgs {
  route: IRoute;
  assets?: any;
  chunks?: any;
  noChunk?: boolean;
}

interface IHtmlChunk {
  name: string;
  headScript?: boolean;
}

interface IChunkMap {
  [key: string]: string;
}

export function chunksToFiles(opts: {
  htmlChunks: (string | object)[];
  chunks?: webpack.compilation.Chunk[];
  noChunk?: boolean;
}): {
  cssFiles: string[];
  jsFiles: string[];
  headJSFiles: string[];
} {
  let chunksMap: IChunkMap = {};
  // 建立chunk中的每个文件`${key}${extname(file)}`到file的映射
  // file是文件名
  if (opts.chunks) {
    chunksMap = Array.from(opts.chunks).reduce((memo, chunk) => {
      const key = chunk.name || chunk.id;
      if (key && chunk.files) {
        chunk.files.forEach((file) => {
          if (!file.includes('.hot-update')) {
            memo[`${key}${extname(file)}`] = file;
          }
        });
      }
      return memo;
    }, {} as IChunkMap);
  }

  const cssFiles: string[] = [];
  const jsFiles: string[] = [];
  const headJSFiles: string[] = [];

  const htmlChunks = opts.htmlChunks.map((htmlChunk) => {
    return lodash.isPlainObject(htmlChunk) ? htmlChunk : { name: htmlChunk };
  });
  (htmlChunks as IHtmlChunk[]).forEach(({ name, headScript }: IHtmlChunk) => {
    // 去找到config中配置的chunks对应在打包过后的cssFile
    const cssFile = opts.noChunk ? `${name}.css` : chunksMap[`${name}.css`];
    if (cssFile) {
      cssFiles.push(cssFile);
    }

    // 同样找到config中配置的chunks对应在打包过后的js
    const jsFile = opts.noChunk ? `${name}.js` : chunksMap[`${name}.js`];
    assert(jsFile, `chunk of ${name} not found.`);

    // 如果需要headScript就加到headJSFiles中
    if (headScript) {
      headJSFiles.push(jsFile);
    } else {
      jsFiles.push(jsFile);
    }
  });

  return {
    cssFiles,
    jsFiles,
    headJSFiles,
  };
}

export function getHtmlGenerator({ api }: { api: IApi }): any {
  function getDocumentTplPath() {
    const docPath = join(api.paths.absPagesPath!, 'document.ejs');
    return existsSync(docPath) ? docPath : '';
  }

  class Html extends api.Html {
    constructor() {
      super({
        config: api.config,
        tplPath: getDocumentTplPath(),
      });
    }

    async getContent(args: IGetContentArgs): Promise<string> {
      async function applyPlugins(opts: { initialState?: any[]; key: string }) {
        return await api.applyPlugins({
          key: opts.key,
          type: api.ApplyPluginsType.add,
          initialValue: opts.initialState || [],
          args: {
            route: args.route,
          },
        });
      }

      // https://umijs.org/config#base
      // 比如，你有路由 / 和 /users，然后设置了 base 为 /foo/，那么就可以通过 /foo/ 和 /foo/users 访问到之前的路由。
      let routerBaseStr = JSON.stringify(api.config.base);
      // https://umijs.org/config#publicpath
      // 配置 webpack 的 publicPath。当打包的时候，webpack 会在静态文件路径前面添加 publicPath 的值
      let publicPathStr = JSON.stringify(api.config.publicPath);

      // 如果设置了exportStatic和dynamicRoot就要在html文件中动态的计算routerBaseStr
      if (api.config.exportStatic && api.config.exportStatic?.dynamicRoot) {
        routerBaseStr = `location.pathname.split('/').slice(0, -${
          args.route.path!.split('/').length - 1
        }).concat('').join('/')`;
        publicPathStr = `location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') + window.routerBase`;
      }

      // window.resourceBaseUrl 用来兼容 egg.js 项目注入的 publicPath
      // 这个publicPathStr会被放在html文件的头部被应用
      publicPathStr = `window.resourceBaseUrl || ${publicPathStr};`;

      publicPathStr = await api.applyPlugins({
        key: 'modifyPublicPathStr',
        type: api.ApplyPluginsType.modify,
        initialValue: publicPathStr,
        args: {
          route: args.route,
        },
      });

      // 这个htmlChunks是在config中配置的chunks，默认为umi文件
      const htmlChunks = await api.applyPlugins({
        key: 'modifyHTMLChunks',
        type: api.ApplyPluginsType.modify,
        initialValue: api.config.chunks || ['umi'],
        args: {
          route: args.route,
          assets: args.assets,
          chunks: args.chunks,
        },
      });

      // 调用chunksToFiles，找到htmlChunks对应到webpack打包完成过后的结果中对应的cssFiles，jsFiles，headJSFiles
      const { cssFiles, jsFiles, headJSFiles } = chunksToFiles({
        htmlChunks,
        chunks: args.chunks,
        noChunk: args.noChunk,
      });

      // 到目前为止收集完了要生成的html文件的内容的opts
      // 接下来就可以调用父亲类上的html类的getContent方法来真正的获取方法，父亲类就是真正的Html类
      return await super.getContent({
        route: args.route,
        cssFiles,
        headJSFiles,
        jsFiles,
        headScripts: await applyPlugins({
          key: 'addHTMLHeadScripts',
          initialState: [
            // routerBase 只在部署路径不固定时才会用到，exportStatic.dynamicRoot
            // UPDATE: 内部 render 会依赖 routerBase，先始终生成
            /* api.config.exportStatic?.dynamicRoot && */ {
              content: `window.routerBase = ${routerBaseStr};`,
            },
            // html 里的 publicPath
            // 只在设置了 runtimePublicPath 或 exportStatic?.dynamicRoot 时才会用到
            // 设置了 exportStatic?.dynamicRoot 时会自动设置 runtimePublicPath
            api.config.runtimePublicPath && {
              content: `window.publicPath = ${publicPathStr};`,
            },
          ].filter(Boolean),
        }),
        links: await applyPlugins({
          key: 'addHTMLLinks',
        }),
        metas: await applyPlugins({
          key: 'addHTMLMetas',
        }),
        scripts: await applyPlugins({
          key: 'addHTMLScripts',
        }),
        styles: await applyPlugins({
          key: 'addHTMLStyles',
        }),
        // @ts-ignore
        async modifyHTML(memo: any, args: object) {
          return await api.applyPlugins({
            key: 'modifyHTML',
            type: api.ApplyPluginsType.modify,
            initialValue: memo,
            args,
          });
        },
      });
    }

    async getRouteMap() {
      const routes = await api.getRoutes();
      const flatRoutes = getFlatRoutes({ routes });

      return flatRoutes.map((route) => {
        // @ts-ignore
        const file = this.getHtmlPath(route.path);
        return {
          route,
          file,
        };
      });
    }
  }

  return new Html();
}

/**
 * flatten routes using routes config
 * @param opts
 */
export function getFlatRoutes(opts: { routes: IRoute[] }): IRoute[] {
  return opts.routes.reduce((memo, route) => {
    const { routes, path } = route;
    if (path && !path.includes('?')) {
      memo.push(route);
    }
    if (routes) {
      memo = memo.concat(
        getFlatRoutes({
          routes,
        }),
      );
    }
    return memo;
  }, [] as IRoute[]);
}
