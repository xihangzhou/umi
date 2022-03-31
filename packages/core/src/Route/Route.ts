import { lodash, winPath } from '@umijs/utils';
import assert from 'assert';
import path, { join } from 'path';
import { IConfig, IRoute } from '..';
import getConventionalRoutes from './getConventionalRoutes';
import routesToJSON from './routesToJSON';

interface IOpts {
  onPatchRoutesBefore?: Function;
  onPatchRoutes?: Function;
  onPatchRouteBefore?: Function;
  onPatchRoute?: Function;
}

interface IGetRoutesOpts {
  config: IConfig;
  // root 通常是 src/pages 目录
  root: string;
  componentPrefix?: string;
  isConventional?: boolean;
  parentRoute?: IRoute;
}

class Route {
  opts: IOpts;
  constructor(opts?: IOpts) {
    this.opts = opts || {};
  }

  // 外部调用的实例方法，将用户的路由配置的各种path变为绝对路径并返回，这个修正相对路径为绝对路径的过程为patch
  async getRoutes(opts: IGetRoutesOpts) {
    const { config, root, componentPrefix } = opts; // 这个config就是/config中导出的自定义配置文件
    // 避免修改配置里的 routes，导致重复 patch
    let routes = lodash.cloneDeep(config.routes); // config.routes就是自定义导出的routes文件
    let isConventional = false;
    if (!routes) {
      // 如果没有自定义路由就使用默认配置路由
      // 如果没有自定义
      assert(root, `opts.root must be supplied for conventional routes.`);
      routes = this.getConventionRoutes({
        root: root!,
        config,
        componentPrefix,
      });
      isConventional = true;
    }
    await this.patchRoutes(routes, {
      ...opts,
      isConventional,
    });
    return routes;
  }

  // TODO:
  // 1. 移动 /404 到最后，并处理 component 和 redirect
  // patchRoutes就只是把现在的routes patchRoute一下而已，调用了key为onPatchRoutesBefore和onPatchRoutes的钩子，具体的注册方式应该在patchRoute中
  async patchRoutes(routes: IRoute[], opts: IGetRoutesOpts) {
    if (this.opts.onPatchRoutesBefore) {
      await this.opts.onPatchRoutesBefore({
        routes,
        parentRoute: opts.parentRoute,
      });
    }
    for (const route of routes) {
      await this.patchRoute(route, opts);
    }
    if (this.opts.onPatchRoutes) {
      await this.opts.onPatchRoutes({
        routes,
        parentRoute: opts.parentRoute,
      });
    }
  }

  // patchRoute方法就是针对一个路由，根据配置的path，redirect等路径相关的配置信息找到最后的目标路径，获取对应路由目标组件的地址
  async patchRoute(route: IRoute, opts: IGetRoutesOpts) {
    // 执行onPatchRouteBefore
    if (this.opts.onPatchRouteBefore) {
      await this.opts.onPatchRouteBefore({
        route,
        parentRoute: opts.parentRoute,
      });
    }

    // route.path 的修改需要在子路由 patch 之前做
    // 如果是相对路径就要和parentRoute?.path进行拼接
    if (
      route.path &&
      route.path.charAt(0) !== '/' &&
      !/^https?:\/\//.test(route.path)
    ) {
      route.path = winPath(join(opts.parentRoute?.path || '/', route.path));
    }
    // 如果有跳转逻辑就也进行拼接
    if (route.redirect && route.redirect.charAt(0) !== '/') {
      route.redirect = winPath(
        join(opts.parentRoute?.path || '/', route.redirect),
      );
    }

    // 如果有子路由就递归处理
    if (route.routes) {
      await this.patchRoutes(route.routes, {
        ...opts,
        parentRoute: route,
      });
    } else {
      if (!('exact' in route)) {
        // exact by default
        route.exact = true;
      }
    }

    // resolve component path
    // 获取component的绝对路径
    if (
      route.component &&
      !opts.isConventional &&
      typeof route.component === 'string' &&
      !route.component.startsWith('@/') &&
      !path.isAbsolute(route.component)
    ) {
      route.component = winPath(join(opts.root, route.component));
    }

    // resolve wrappers path
    if (route.wrappers) {
      route.wrappers = route.wrappers.map((wrapper) => {
        if (wrapper.startsWith('@/') || path.isAbsolute(wrapper)) {
          return wrapper;
        } else {
          return winPath(join(opts.root, wrapper));
        }
      });
    }

    if (this.opts.onPatchRoute) {
      await this.opts.onPatchRoute({
        route,
        parentRoute: opts.parentRoute,
      });
    }
  }

  getConventionRoutes(opts: any): IRoute[] {
    return getConventionalRoutes(opts);
  }

  getJSON(opts: {
    routes: IRoute[];
    config: IConfig;
    cwd: string;
    isServer?: boolean;
  }) {
    return routesToJSON(opts);
  }

  getPaths({ routes }: { routes: IRoute[] }): string[] {
    return lodash.uniq(
      routes.reduce((memo: string[], route) => {
        if (route.path) memo.push(route.path);
        if (route.routes)
          memo = memo.concat(this.getPaths({ routes: route.routes }));
        return memo;
      }, []),
    );
  }
}

export default Route;
