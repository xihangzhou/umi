exports.__esModule = true;
exports.isWebpack5 = false;
exports.default = undefined;

// 把webpack类的属性都放到source类上
function assignWithGetter(source, webpack) {
  Object.keys(webpack).forEach(key => {
    Object.defineProperty(source, key, {
      get() { return webpack[key]; }
    });
  });
}

let initializedWebpack5 = false;
let initializedWebpack4 = false;
let initFns = [];
let inited = false;
// commonjs的导出方式，可以直接使用exports导出，不需要加module
exports.init = function (useWebpack5) {
  // allow init once
  if (inited) return;
  inited = true;

  if (useWebpack5) {
    Object.assign(exports, require('./5/bundle5')());
    // Object.assign(exports, require('./5/bundle5')().webpack);
    assignWithGetter(exports, require('./5/bundle5')().webpack);
    exports.isWebpack5 = true;
    exports.default = require('./5/bundle5')().webpack;
    if (!initializedWebpack5) for (const cb of initFns) cb();
    initializedWebpack5 = true;
  } else {
    // require('./4/bundle4')()的返回值是一个实例，属性是webpack上自带的和node交互的api或者是插件类
    // 首先导出这个类
    // webpack方法 https://webpack.docschina.org/api/node/
    Object.assign(exports, require('./4/bundle4')());
    // 把这个类下的webpack类的每个属性也放在exports中，webpack本来是一个运行webpack的函数，但是带有其他的属性
    assignWithGetter(exports, require('./4/bundle4')().webpack);
    exports.isWebpack5 = false; // 导出webpack不是5代
    exports.default = require('./4/bundle4')().webpack; // 默认导出webpack方法
    if (!initializedWebpack4) for (const cb of initFns) cb(); // 掉用任务队列回调函数
    initializedWebpack4 = true;
  }
}

// 导出onWebpackInit函数，这个函数的意义就是如果已经初始化完成了就直接执行cb,否则放在任务队列
exports.onWebpackInit = function (cb) {
  if (initializedWebpack5 || initializedWebpack4) cb();
  initFns.push(cb);
}
