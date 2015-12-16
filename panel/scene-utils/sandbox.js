'use strict';

const Path = require('path');
const Fs = require('fire-fs');
const FireUrl = require('fire-url');

let sysRequire = require;
let builtinClassIds;
let builtinClassNames;
let builtinComponentMenus;
// let builtinCustomAssetMenus;

let initialized = false;
let loadedScriptNodes = [];

function init () {
  // Sandbox.globalVarsChecker = new GlobalVarsChecker().record();
  builtinClassIds = cc.js._registeredClassIds;
  builtinClassNames = cc.js._registeredClassNames;
  builtinComponentMenus = cc._componentMenuItems.slice();
  // builtinCustomAssetMenus = cc._customAssetMenuItems.slice();
}

function reset () {
  // clear
  cc.Object._deferredDestroy();
  //// reset menus
  cc._componentMenuItems = builtinComponentMenus.slice();
  //cc._customAssetMenuItems = builtinCustomAssetMenus.slice();
  //// Editor.MainMenu.reset();
  // remove user classes
  cc.js._registeredClassIds = builtinClassIds;
  cc.js._registeredClassNames = builtinClassNames;
  ////
  cc._LoadManager.reset();
  // 清除 browserify 声明的 require 后，除非用户另外找地方存了原来的 require，否则之前的脚本都将会被垃圾回收
  require = sysRequire;

  cc._RFreset();
  Editor.clearUrlToUuidCache();

  cc.director.purgeDirector();
  cc.loader.releaseAll();
}

let Sandbox = {
  reset: reset,

  reload (compiled) {
    this.compiled = compiled;
    _Scene.stashScene(() => {
      // reload connected browser
      Editor.sendToCore('app:reload-on-device');

      //
      reset();

      // reload
      _Scene.initScene();
    });
  },

  loadCompiledScript (next) {
    if ( Editor.remote.Compiler.state !== 'idle' ) {
      setTimeout(() => {
        Sandbox.loadCompiledScript(next);
      }, 50);

      return;
    }

    if (!initialized) {
      initialized = true;
      init();
    }

    function doLoad (src, cb) {
      let script = document.createElement('script');
      script.onload = function () {
        console.timeEnd('load ' + src);
        cb();
      };
      script.onerror = function () {
        console.timeEnd('load ' + src);
        if (loadedScriptNodes.length > 0) {
          cc.loader.unloadAll();
        }
        console.error('Failed to load %s', src);
        cb(new Error('Failed to load ' + src));
      };
      script.setAttribute('type','text/javascript');
      script.setAttribute('charset', 'utf-8');
      script.setAttribute('src', FireUrl.addRandomQuery(src));
      console.time('load ' + src);
      document.head.appendChild(script);
      loadedScriptNodes.push(script);
    }

    let scriptPath = Path.join(Editor.libraryPath, 'bundle.project.js');
    Fs.exists(scriptPath, exists => {
      if (exists) {
        doLoad(scriptPath, err => {
          Editor.updateComponentMenu();
          next(err);
        });
      } else {
        Editor.updateComponentMenu();
        next();
      }
    });
  },

  unloadCompiledScript () {
    // remove script element
    for ( let i = 0; i < loadedScriptNodes.length; i++ ) {
      let node = loadedScriptNodes[i];
      node.remove();
    }
    loadedScriptNodes.length = 0;
  },

  compiled: false
};

Editor.Sandbox = Sandbox;
