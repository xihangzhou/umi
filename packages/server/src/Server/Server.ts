// @ts-ignore
import { Logger } from '@umijs/core';
import compress, { CompressionOptions } from '@umijs/deps/compiled/compression';
import express, { Express, RequestHandler } from '@umijs/deps/compiled/express';
import {
  createProxyMiddleware,
  Filter as ProxyFilter,
  Options as ProxyOptions,
  RequestHandler as ProxyRequestHandler,
} from '@umijs/deps/compiled/http-proxy-middleware';
import sockjs, {
  Connection,
  Server as SocketServer,
} from '@umijs/deps/compiled/sockjs';
import spdy, { ServerOptions } from '@umijs/deps/compiled/spdy';
import { createDebug, lodash, PartialProps, portfinder } from '@umijs/utils';
import * as http from 'http';
import * as url from 'url';
import { getCredentials } from './utils';

const logger = new Logger('@umijs/server');
const debug = createDebug('umi:server:Server');

interface IServerProxyConfigItem extends ProxyOptions {
  path?: string | string[];
  context?: string | string[] | ProxyFilter;
  bypass?: (
    req: Express.Request,
    res: Express.Response,
    proxyConfig: IServerProxyConfigItem,
  ) => string | null;
}

type IServerProxyConfig =
  | IServerProxyConfigItem
  | Record<string, IServerProxyConfigItem>
  | (IServerProxyConfigItem | (() => IServerProxyConfigItem))[]
  | null;

export interface IHttps extends ServerOptions {}

export interface IServerOpts {
  afterMiddlewares?: RequestHandler<any>[];
  beforeMiddlewares?: RequestHandler<any>[];
  compilerMiddleware?: RequestHandler<any> | null;
  https?: IHttps | boolean;
  headers?: {
    [key: string]: string;
  };
  host?: string;
  port?: number;
  compress?: CompressionOptions | boolean;
  proxy?: IServerProxyConfig;
  onListening?: {
    ({
      port,
      hostname,
      listeningApp,
      server,
    }: {
      port: number;
      hostname: string;
      listeningApp: http.Server;
      server: Server;
    }): void;
  };
  onConnection?: (param: { connection: Connection; server: Server }) => void;
  onConnectionClose?: (param: { connection: Connection }) => void;
  writeToDisk?: boolean | ((filePath: string) => boolean);
}

const defaultOpts: Required<PartialProps<IServerOpts>> = {
  afterMiddlewares: [],
  beforeMiddlewares: [],
  compilerMiddleware: null,
  compress: true,
  // enable by default if add HTTP2
  https: !!process.env.HTTP2 ? true : !!process.env.HTTPS,
  onListening: (argv) => argv,
  onConnection: () => {},
  onConnectionClose: () => {},
  proxy: null,
  headers: {},
  // not use
  host: 'localhost',
  port: 8000,
  writeToDisk: false,
};

class Server {
  app: Express;
  opts: Required<IServerOpts>;
  socketServer?: SocketServer; // 生辰过的socketServer
  // @ts-ignore
  listeningApp: http.Server; // 生成的服务器服务实例
  // @ts-ignore
  listeninspdygApp: http.Server;
  sockets: Connection[] = [];
  // Proxy sockets
  socketProxies: ProxyRequestHandler[] = [];

  constructor(opts: IServerOpts) {
    this.opts = {
      ...defaultOpts,
      ...lodash.omitBy(opts, lodash.isUndefined), // 删除undefined的值
    };
    this.app = express(); // 使用express框架来进行服务的书写
    this.setupFeatures(); // 设置这个服务的各种中间件
    this.createServer(); // 新建服务

    // 如果监听到了upgrade事件就要执行wsProxy中的upgrade方法
    this.socketProxies.forEach((wsProxy) => {
      // subscribe to http 'upgrade'
      // @ts-ignore
      this.listeningApp.on('upgrade', wsProxy.upgrade);
    }, this);
  }

  private getHttpsOptions(): object | undefined {
    // 如果开启了https的要求就要获取凭证等一系列东西
    if (this.opts.https) {
      const credential = getCredentials(this.opts);

      // note that options.spdy never existed. The user was able
      // to set options.https.spdy before, though it was not in the
      // docs. Keep options.https.spdy if the user sets it for
      // backwards compatibility, but log a deprecation warning.
      if (typeof this.opts.https === 'object' && this.opts.https.spdy) {
        // for backwards compatibility: if options.https.spdy was passed in before,
        // it was not altered in any way
        logger.warn(
          'Providing custom spdy server options is deprecated and will be removed in the next major version.',
        );
        return credential;
      } else {
        return {
          spdy: {
            protocols: ['h2', 'http/1.1'],
          },
          ...credential,
        };
      }
    }
    return;
  }

  // 这个setupFeatures就是去设置中间件的过程，注意express的中间件按顺序深度遍历递归执行
  setupFeatures() {
    const features = {
      compress: () => {
        this.app.get('/', function (req, res) {
          console.log('Cookies: ');
        });
        if (this.opts.compress) {
          // 如果有设置compress就采用compress中间件
          this.setupCompress();
        }
      },
      headers: () => {
        if (lodash.isPlainObject(this.opts.headers)) {
          this.setupHeaders();
        }
      },
      beforeMiddlewares: () => {
        // 应用传入的中间件
        this.opts.beforeMiddlewares.forEach((middleware) => {
          // @ts-ignore
          this.app.use(middleware);
        });
      },
      // 设置代理
      proxy: () => {
        if (this.opts.proxy) {
          this.setupProxy();
        }
      },
      // 编译中间件
      compilerMiddleware: () => {
        if (this.opts.compilerMiddleware) {
          // @ts-ignore
          this.app.use(this.opts.compilerMiddleware); // 这个compilerMiddleware就是webpack返回的compilerMiddleware
        }
      },
      // 最后的中间件，注意在编译中间件运行之后，当afterMiddlewares执行的时候理论上是需要编译完成了的
      afterMiddlewares: () => {
        this.opts.afterMiddlewares.forEach((middleware) => {
          // @ts-ignore
          this.app.use(middleware);
        });
      },
    };

    Object.keys(features).forEach((stage) => {
      features[stage]();
    });
  }

  /**
   * response headers
   */
  setupHeaders() {
    this.app.all('*', (req, res, next) => {
      // eslint-disable-next-line
      res.set(this.opts.headers); // 设置响应头
      next();
    });
  }

  /**
   * dev server compress to gzip assets
   */
  setupCompress() {
    const compressOpts = lodash.isBoolean(this.opts.compress)
      ? {}
      : this.opts.compress;
    this.app.use(compress(compressOpts));
  }

  deleteRoutes() {
    let startIndex = null;
    let endIndex = null;
    this.app._router.stack.forEach((item: any, index: number) => {
      if (item.name === 'PROXY_START') startIndex = index;
      if (item.name === 'PROXY_END') endIndex = index;
    });
    debug(
      `routes before changed: ${this.app._router.stack
        .map((item: any) => item.name || 'undefined name')
        .join(', ')}`,
    );
    if (startIndex !== null && endIndex !== null) {
      this.app._router.stack.splice(startIndex, endIndex - startIndex + 1);
    }
    debug(
      `routes after changed: ${this.app._router.stack
        .map((item: any) => item.name || 'undefined name')
        .join(', ')}`,
    );
  }

  /**
   * proxy middleware for dev
   * not coupled with build tools (like webpack, rollup, ...)
   */
  setupProxy(proxyOpts?: IServerProxyConfig, isWatch: boolean = false) {
    let proxy = proxyOpts || this.opts.proxy;
    if (!Array.isArray(proxy)) {
      if (proxy && 'target' in proxy) {
        proxy = [proxy];
      } else {
        proxy = Object.keys(proxy || {}).map((context) => {
          let proxyOptions: IServerProxyConfigItem;
          // For backwards compatibility reasons.
          const correctedContext = context
            .replace(/^\*$/, '**')
            .replace(/\/\*$/, '');

          if (typeof proxy?.[context] === 'string') {
            proxyOptions = {
              context: correctedContext,
              target: proxy[context],
            };
          } else {
            proxyOptions = {
              ...(proxy?.[context] || {}),
              context: correctedContext,
            };
          }

          proxyOptions.logLevel = proxyOptions.logLevel || 'warn';

          return proxyOptions;
        });
      }
    }

    const getProxyMiddleware = (
      proxyConfig: IServerProxyConfigItem,
    ): ProxyRequestHandler | undefined => {
      const context = proxyConfig.context || proxyConfig.path;

      // It is possible to use the `bypass` method without a `target`.
      // However, the proxy middleware has no use in this case, and will fail to instantiate.
      if (proxyConfig.target) {
        return createProxyMiddleware(context!, {
          ...proxyConfig,
          onProxyRes(proxyRes, req: any, res) {
            const target =
              typeof proxyConfig.target === 'object'
                ? url.format(proxyConfig.target)
                : proxyConfig.target;
            const realUrl = new URL(req.url || '', target)?.href || '';
            proxyRes.headers['x-real-url'] = realUrl;
            proxyConfig.onProxyRes?.(proxyRes, req, res);
          },
        });
      }

      return;
    };

    // refresh proxy config
    let startIndex = null;
    let endIndex = null;
    let routesLength = null;

    // when proxy opts change, delete before proxy middlwares
    if (isWatch) {
      this.app._router.stack.forEach((item: any, index: number) => {
        if (item.name === 'PROXY_START') startIndex = index;
        if (item.name === 'PROXY_END') endIndex = index;
      });
      if (startIndex !== null && endIndex !== null) {
        this.app._router.stack.splice(startIndex, endIndex - startIndex + 1);
      }
      routesLength = this.app._router.stack.length;

      this.deleteRoutes();
    }

    // log proxy middleware before
    this.app.use(function PROXY_START(req, res, next) {
      next();
    });

    proxy.forEach((proxyConfigOrCallback) => {
      let proxyMiddleware: ProxyRequestHandler | undefined;

      let proxyConfig =
        typeof proxyConfigOrCallback === 'function'
          ? proxyConfigOrCallback()
          : proxyConfigOrCallback;

      proxyMiddleware = getProxyMiddleware(proxyConfig);

      if (proxyConfig.ws && proxyMiddleware) {
        this.socketProxies.push(proxyMiddleware);
      }

      this.app.use((req, res, next) => {
        if (typeof proxyConfigOrCallback === 'function') {
          const newProxyConfig = proxyConfigOrCallback();

          if (newProxyConfig !== proxyConfig) {
            proxyConfig = newProxyConfig;
            proxyMiddleware = getProxyMiddleware(proxyConfig);
          }
        }

        // - Check if we have a bypass function defined
        // - In case the bypass function is defined we'll retrieve the
        // bypassUrl from it otherwise bypassUrl would be null
        const bypassUrl = lodash.isFunction(proxyConfig.bypass)
          ? proxyConfig.bypass(req, res, proxyConfig)
          : null;
        if (typeof bypassUrl === 'boolean') {
          // skip the proxy
          // @ts-ignore
          req.url = null;
          next();
        } else if (typeof bypassUrl === 'string') {
          // byPass to that url
          req.url = bypassUrl;
          next();
        } else if (proxyMiddleware) {
          return (proxyMiddleware as any)(req, res, next);
        } else {
          next();
        }
      });
    });

    this.app.use(function PROXY_END(req, res, next) {
      next();
    });

    // log proxy middleware after
    if (isWatch) {
      const newRoutes = this.app._router.stack.splice(
        routesLength,
        this.app._router.stack.length - routesLength,
      );
      this.app._router.stack.splice(startIndex, 0, ...newRoutes);
    }
  }

  sockWrite({
    sockets = this.sockets,
    type,
    data,
  }: {
    sockets?: Connection[];
    type: string;
    data?: string | object;
  }) {
    sockets.forEach((socket) => {
      socket.write(JSON.stringify({ type, data }));
    });
  }

  // 建立服务，如果是https建立https服务，并且把服务放在listeningApp上
  createServer() {
    const httpsOpts = this.getHttpsOptions();
    if (httpsOpts) {
      // http2 using spdy, HTTP/2 by default when using https
      this.listeningApp = spdy.createServer(httpsOpts, this.app);
    } else {
      this.listeningApp = http.createServer(this.app); // 使用http.createServer的方式传入express实例生成一个实例
    }
  }

  async listen({
    port = 8000,
    hostname,
  }: {
    port?: number;
    hostname: string;
  }): Promise<{
    port: number;
    hostname: string;
    listeningApp: http.Server;
    server: Server;
  }> {
    const foundPort = await portfinder.getPortPromise({ port });
    return new Promise((resolve) => {
      this.listeningApp.listen(foundPort, hostname, 5, () => {
        this.createSocketServer(); // 创建这个server服务对应的socket服务从tcpip的层面上去控制每一次tcp连接
        const ret = {
          port: foundPort,
          hostname,
          listeningApp: this.listeningApp,
          server: this,
        };
        this.opts.onListening(ret);
        resolve(ret);
      });
    });
  }

  createSocketServer() {
    const server = sockjs.createServer({
      log: (severity, line) => {
        if (line.includes('bound to')) return;
        // console.log(`${chalk.gray('[sockjs]')} ${line}`);
      },
    });
    server.installHandlers(this.listeningApp!, {
      prefix: '/dev-server',
    });
    server.on('connection', (connection) => {
      // Windows connection might be undefined
      // https://github.com/webpack/webpack-dev-server/issues/2199
      // https://github.com/sockjs/sockjs-node/issues/121
      // https://github.com/meteor/meteor/pull/10891/files
      if (!connection) {
        return;
      }
      this.opts.onConnection({
        connection,
        server: this,
      });
      this.sockets.push(connection);
      connection.on('close', () => {
        this.opts.onConnectionClose({
          connection,
        });
        const index = this.sockets.indexOf(connection);
        if (index >= 0) {
          this.sockets.splice(index, 1);
        }
      });
    });
    this.socketServer = server;
  }
}

export default Server;
