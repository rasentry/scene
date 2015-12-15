'use strict';

const Async = require('async');

function enterEditMode ( stashedScene, next ) {
  if ( stashedScene ) {
    // restore selection
    Editor.Selection.select('node', stashedScene.sceneSelection, true, true);

    // restore scene view
    _Scene.view.initPosition(
      stashedScene.sceneOffsetX,
      stashedScene.sceneOffsetY,
      stashedScene.sceneScale
    );
  }

  next();
}

function createScene (sceneJson, next) {
  //var MissingBehavior = require('./missing-behavior');

  // reset scene
  _Scene.reset();

  cc.AssetLibrary.loadJson(sceneJson, next);
}

let Scene = {
  init ( sceneView, gizmosView ) {
    this.view = sceneView;
    this.gizmosView = gizmosView;

    this.Undo.init();
    this.Undo.on('changed', () => {
      Editor.sendToCore('scene:update-title', this.Undo.dirty());
    });
  },

  reset () {
    Editor.Selection.clear('node');

    // reset scene gizmos, scene grid
    this.gizmosView.reset();

    // reset cc.engine editing state
    cc.engine.animatingInEditMode = false;
  },

  defaultScene () {
    let scene = new cc.Scene();
    let canvas = new cc.Node('Canvas');
    canvas.parent = scene;
    canvas.addComponent(cc.Canvas);

    cc.director.runScene(scene);
  },

  newScene () {
    this.reset();
    this.defaultScene();
    this.view.adjustToCenter(20);

    cc.engine.repaintInEditMode();
    Editor.remote.currentSceneUuid = null;
  },

  loadSceneByUuid (uuid, cb) {
    this.reset();

    cc.director._loadSceneByUuid(uuid, err => {
      this.view.adjustToCenter(20);
      cc.engine.repaintInEditMode();

      if (!err) {
        Editor.remote.currentSceneUuid = uuid;
      }

      if ( cb ) {
        cb (err);
      }
    });
  },

  initScene (cb) {
    let stashedScene = Editor.remote.stashedScene; // a remote sync method
    let sceneJson = stashedScene ? stashedScene.sceneJson : null;

    if (sceneJson) {
      // load last editing scene
      Async.waterfall([
        Editor.Sandbox.loadCompiledScript,
        createScene.bind(this, sceneJson),
        (scene, next) => {
          cc.director.runScene(scene);
          cc.engine.repaintInEditMode();
          next( null, stashedScene );
        },
        enterEditMode,
      ], cb);
    } else {
      Async.waterfall([
        Editor.Sandbox.loadCompiledScript,
        next => {
          let currentSceneUuid = Editor.remote.currentSceneUuid;
          if ( currentSceneUuid ) {
            cc.director._loadSceneByUuid(currentSceneUuid, err => {
              this.view.adjustToCenter(10);
              cc.engine.repaintInEditMode();
              next ( err, null );
            });
            return;
          }

          this.defaultScene();
          this.view.adjustToCenter(20);

          next( null, null );
        },
        enterEditMode,
      ], cb );
    }
  },

  stashScene ( cb ) {
    // get scene json
    let scene = cc.director.getScene();
    let jsonText = Editor.serialize(scene, {stringify: true});

    // store the scene, scene-view postion, scene-view scale
    Editor.remote.stashedScene = {
      sceneJson: jsonText,
      sceneScale: this.view.scale,
      sceneOffsetX: this.view.$.grid.xAxisOffset,
      sceneOffsetY: this.view.$.grid.yAxisOffset,
      designWidth: this.gizmosView.designSize[0],
      designHeight: this.gizmosView.designSize[1],
      sceneSelection: Editor.Selection.curSelection('node'),
    };

    if ( cb ) {
      cb(null, jsonText);
    }
  },

  softReload (compiled) {
    // hot update new compiled scripts
    Editor.Sandbox.reload(compiled);
  },

  // DISABLE
  // reloadScene ( cb ) {
  //   Async.waterfall([
  //     this.stashScene,
  //     createScene,
  //     (scene, next) => {
  //       cc.director.runScene(scene);
  //       cc.engine.repaintInEditMode();
  //       next( null, Editor.remote.stashedScene );
  //     },
  //     enterEditMode,
  //   ], cb );
  // },

  // DISABLE
  // playScene ( cb ) {
  //   // store selection
  //   let selection = Editor.Selection.curSelection('node');

  //   Async.waterfall([
  //     this.stashScene,
  //     createScene,  // instantiate a new scene to play
  //     (scene, next) => {
  //       // setup scene list
  //       cc.game._sceneInfos = Editor.remote.sceneList.map(info => {
  //         return { url: info.url, uuid: info.uuid };
  //       });

  //       // reset scene camera
  //       scene.position = cc.Vec2.ZERO;
  //       scene.scale = cc.Vec2.ONE;

  //       // play new scene
  //       cc.director.runScene(scene, () => {
  //         // restore selection
  //         Editor.Selection.select('node', selection, true, true);

  //         //
  //         this.view.$.grid.hidden = true;
  //         this.view.$.gizmosView.hidden = true;

  //         //if (this.$.pause.active) {
  //         //  cc.engine.step();
  //         //}
  //         //else {
  //         cc.engine.play();
  //         //}
  //       });
  //       next();
  //     },
  //   ], cb);
  // },
};

window._Scene = Scene;
