import { IApi, NextFunction, Request, Response } from '@umijs/types';
import { extname, join } from 'path';
import { matchRoutes, RouteConfig } from 'react-router-config';
import { Stream } from 'stream';
import { getHtmlGenerator } from '../htmlUtils';

const ASSET_EXTNAMES = [
  '.ico',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.json',
];

export default ({
  api,
  sharedMap,
}: {
  api: IApi;
  sharedMap: Map<string, string>;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    async function sendHtml() {
      const html = getHtmlGenerator({ api });

      let route: RouteConfig = { path: req.path };
      // https://umijs.org/config#exportstatic
      // 如果开启 exportStatic，则会针对每个路由输出 html 文件。
      if (api.config.exportStatic) {
        const routes = (await api.getRoutes()) as RouteConfig[];
        const matchedRoutes = matchRoutes(routes, req.path);
        if (matchedRoutes.length) {
          route = matchedRoutes[matchedRoutes.length - 1].route;
        }
      }
      // 获取html文件的内容
      const defaultContent = await html.getContent({
        route,
        chunks: sharedMap.get('chunks'),
      });
      // 支持通过注册生命周期对defaultContent进行修改
      const content = await api.applyPlugins({
        key: 'modifyDevHTMLContent',
        type: api.ApplyPluginsType.modify,
        initialValue: defaultContent,
        args: {
          req,
        },
      });
      // 设置响应头
      res.setHeader('Content-Type', 'text/html');

      // support stream content
      if (content instanceof Stream) {
        content.pipe(res);
        content.on('end', function () {
          res.end();
        });
      } else {
        res.send(content);
      }
    }

    // 如果请求路径为/favicon.ico直接返回umi.png文件
    if (req.path === '/favicon.ico') {
      res.sendFile(join(__dirname, 'umi.png'));
    } else if (ASSET_EXTNAMES.includes(extname(req.path))) {
      // 如果是静态文件，就什么也不做
      next();
    } else {
      // 否则就sendHtml
      await sendHtml();
    }
  };
};
