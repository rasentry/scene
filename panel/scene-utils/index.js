'use strict';

const Async = require('async');
const Url = require('fire-url');

function getTopLevelNodes (nodes) {
  return Editor.Utils.arrayCmpFilter(nodes, (a, b) => {
    if (a === b) {
      return 0;
    }
    if (b.isChildOf(a)) {
      return 1;
    }
    if (a.isChildOf(b)) {
      return -1;
    }
    return 0;
  });
}

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


function callOnFocusInTryCatch (c) {
  try {
    c.onFocusInEditor();
  } catch (e) {
    cc._throw(e);
  }
}

function callOnLostFocusInTryCatch (c) {
  try {
    c.onLostFocusInEditor();
  } catch (e) {
    cc._throw(e);
  }
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

  softReload (compiled) {
    // hot update new compiled scripts
    Editor.Sandbox.reload(compiled);
  },

  // ==============================
  // scene operation
  // ==============================

  defaultScene () {
    let scene = new cc.Scene();
    let canvas = new cc.Node('Canvas');
    canvas.parent = scene;
    canvas.addComponent(cc.Canvas);

    cc.director.runScene(scene);
  },

  newScene ( cb ) {
    this.reset();
    this.defaultScene();
    this.view.adjustToCenter(20);

    cc.engine.repaintInEditMode();

    Editor.sendRequestToCore('scene:set-current-scene', null, () => {
      if ( cb ) {
        cb ();
      }
    });
  },

  loadSceneByUuid (uuid, cb) {
    this.reset();

    cc.director._loadSceneByUuid(uuid, err => {
      this.view.adjustToCenter(20);
      cc.engine.repaintInEditMode();

      if (err) {
        if ( cb ) {
          cb (err);
        }
        return;
      }

      Editor.sendRequestToCore('scene:set-current-scene', uuid, () => {
        if ( cb ) {
          cb ();
        }
      });
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

  saveScene ( cb ) {
    var sceneAsset = new cc.SceneAsset();
    sceneAsset.scene = cc.director.getScene();

    // NOTE: we stash scene because we want to save and reload the connected browser
    this.stashScene(() => {
      // reload connected browser
      Editor.sendToCore('app:reload-on-device');
      Editor.sendToCore('scene:save-scene', Editor.serialize(sceneAsset));

      if ( cb ) {
        cb ();
      }
    });
  },

  currentScene () {
    return cc.director.getScene();
  },

  // ==============================
  // node operation
  // ==============================

  createNodes ( assetUuids, parentID ) {
    let parentNode;
    if ( parentID ) {
      parentNode = cc.engine.getInstanceById(parentID);
    }
    if ( !parentNode ) {
      parentNode = cc.director.getScene();
    }

    Editor.Selection.unselect(
      'node',
      Editor.Selection.curSelection('node'),
      false
    );

    //
    Async.each( assetUuids, ( uuid, done ) => {
      Async.waterfall([
        next => {
          Editor.createNode(uuid, next);
        },

        ( node, next ) => {
          let nodeID;
          if ( node ) {
            nodeID = node.uuid;

            if ( parentNode ) {
              node.parent = parentNode;
            }
            let centerX = cc.game.canvas.width / 2;
            let centerY = cc.game.canvas.height / 2;
            node.scenePosition = this.view.pixelToScene( cc.v2(centerX, centerY) );

            _Scene.Undo.recordCreateNode(nodeID);
          }

          next ( null, nodeID );
        }

      ], ( err, nodeID ) => {
        if ( err ) {
          Editor.failed( `Failed to drop asset ${uuid}, message: ${err.stack}` );
          return;
        }

        if ( nodeID ) {
          Editor.Selection.select('node', nodeID, false, false );
        }

        cc.engine.repaintInEditMode();
        done();
      });
    }, err => {
      _Scene.Undo.commit();

      if ( err ) {
        Editor.Selection.cancel();
        return;
      }

      Editor.Selection.confirm();
    });
  },

  createNodesAt ( assetUuids, x, y ) {
    Editor.Selection.cancel();
    Editor.Selection.clear('node');

    Async.each(assetUuids, ( uuid, done ) => {
      Async.waterfall([
        next => {
          Editor.createNode(uuid, next);
        },

        ( node, next ) => {
          var nodeID;
          if ( node ) {
            nodeID = node.uuid;

            node.setPosition(this.view.pixelToScene( cc.v2(x,y) ));
            node.parent = cc.director.getScene();
          }

          _Scene.Undo.recordCreateNode(nodeID);
          _Scene.Undo.commit();

          next ( null, nodeID );
        },

      ], ( err, nodeID ) => {
        if ( err ) {
          Editor.failed( `Failed to drop asset ${uuid}, message: ${err.stack}` );
          return;
        }

        if ( nodeID ) {
          Editor.Selection.select('node', nodeID, false, true );
        }

        cc.engine.repaintInEditMode();
        done();
      });
    });
  },

  createNodeByClassID ( name, classID, referenceID, isSibling ) {
    let parent;

    if ( referenceID ) {
      parent = cc.engine.getInstanceById(referenceID);
      if ( isSibling ) {
        parent = parent.parent;
      }
    }

    if ( !parent ) {
      parent = cc.director.getScene();
    }

    let node = new cc.Node(name);
    node.parent = parent;

    let centerX = cc.game.canvas.width / 2;
    let centerY = cc.game.canvas.height / 2;
    node.scenePosition = this.view.pixelToScene( cc.v2(centerX, centerY) );

    if (classID) {
      // add component
      let CompCtor = cc.js._getClassById(classID);
      if (CompCtor) {
        node.addComponent(CompCtor);
      } else {
        Editor.error( `Unknown node to create: ${classID}` );
      }
    }

    cc.engine.repaintInEditMode();
    Editor.Selection.select('node', node.uuid, true, true );

    _Scene.Undo.recordCreateNode(node.uuid);
    _Scene.Undo.commit();
  },

  createNodeByPrefab ( name, prefabID, referenceID, isSibling ) {
    let parent;

    Editor.createNode(prefabID, (err, node) => {
      if ( err ) {
        Editor.error(err);
        return;
      }

      Editor.PrefabUtils.unlinkPrefab(node);

      node.name = name;

      if ( referenceID ) {
        parent = cc.engine.getInstanceById(referenceID);
        if ( isSibling ) {
          parent = parent.parent;
        }
      }
      if ( !parent ) {
        parent = cc.director.getScene();
      }

      node.parent = parent;

      let centerX = cc.game.canvas.width / 2;
      let centerY = cc.game.canvas.height / 2;
      node.scenePosition = this.view.pixelToScene( cc.v2(centerX, centerY) );

      cc.engine.repaintInEditMode();
      Editor.Selection.select('node', node.uuid, true, true );

      _Scene.Undo.recordCreateNode(node.uuid);
      _Scene.Undo.commit();
    });
  },

  deleteNodes ( ids ) {
    for (let i = 0; i < ids.length; i++) {
      let id = ids[i];
      let node = cc.engine.getInstanceById(id);
      if (node) {
        node._destroyForUndo(() => {
          this.Undo.recordDeleteNode(id);
        });
      }
    }
    this.Undo.commit();
    Editor.Selection.unselect('node', ids, true);
  },

  duplicateNodes ( ids ) {
    let nodes = [];
    for ( let i = 0; i < ids.length; ++i ) {
      let node = cc.engine.getInstanceById(ids[i]);
      if (node) {
        nodes.push(node);
      }
    }

    let results = getTopLevelNodes(nodes);

    // duplicate results
    let clones = [];
    results.forEach(node => {
      let clone = cc.instantiate(node);
      clone.parent = node.parent;

      clones.push(clone.uuid);
    });

    // select the last one
    Editor.Selection.select('node', clones);
  },

  moveNodes ( ids, parentID, nextSiblingId ) {
    function getSiblingIndex (node) {
      return node._parent._children.indexOf(node);
    }

    let parent;

    if (parentID) {
      parent = cc.engine.getInstanceById(parentID);
    } else {
      parent = cc.director.getScene();
    }

    let next = nextSiblingId ? cc.engine.getInstanceById(nextSiblingId) : null;
    let nextIndex = next ? getSiblingIndex(next) : -1;

    for (let i = 0; i < ids.length; i++) {
      let id = ids[i];
      let node = cc.engine.getInstanceById(id);

      if (node && (!parent || !parent.isChildOf(node))) {
        _Scene.Undo.recordMoveNode(id);

        if (node.parent !== parent) {
          // keep world transform not changed
          let worldPos = node.worldPosition;
          let worldRotation = node.worldRotation;
          let lossyScale = node.worldScale;

          node.parent = parent;

          // restore world transform
          node.worldPosition = worldPos;
          node.worldRotation = worldRotation;
          if (parent) {
            lossyScale.x /= parent.worldScale.x;
            lossyScale.y /= parent.worldScale.y;
            node.scale = lossyScale;
          } else {
            node.scale = lossyScale;
          }

          if (next) {
            node.setSiblingIndex(nextIndex);
            ++nextIndex;
          }
        } else if (next) {
          let lastIndex = getSiblingIndex(node);
          let newIndex = nextIndex;

          if (newIndex > lastIndex) {
            --newIndex;
          }

          if (newIndex !== lastIndex) {
            node.setSiblingIndex(newIndex);

            if (lastIndex > newIndex) {
              ++nextIndex;
            } else {
              --nextIndex;
            }
          }
        } else {
          // move to bottom
          node.setSiblingIndex(-1);
        }
      }
    }

    _Scene.Undo.commit();
  },

  addComponent ( nodeID, compID ) {
    if ( arguments.length === 1 ) {
      compID = nodeID;
      nodeID = Editor.Selection.curActivate('node');
    }

    if ( !nodeID ) {
      Editor.warn('Please select a node first');
      return;
    }

    if ( !compID ) {
      Editor.error('Component ID is undefined');
      return;
    }

    if (compID) {
      let isScript = Editor.isUuid(compID);
      let compCtor = cc.js._getClassById(compID);
      if (!compCtor) {
        if (isScript) {
          Editor.error(`Can not find cc.Component in the script ${compID}.`);
          return;
        }

        Editor.error(`Failed to get component ${compID}`);
        return;
      }

      let node = cc.engine.getInstanceById(nodeID);
      if (!node) {
        Editor.error( `Can not find node ${nodeID}` );
        return;
      }

      if (compCtor._disallowMultiple) {
        let existing = node.getComponent(compCtor._disallowMultiple);
        if (existing) {
          let detail;
          if (existing.constructor === compCtor) {
            detail = 'Already contains the same component';
          } else {
            detail = `Already contains the same or derived component '${cc.js.getClassName(existing)}.`;
          }

          Editor.Dialog.messageBox({
            type: 'warning',
            buttons: ['OK'],
            title: 'Warning',
            message: `Can\'t add component '${cc.js.getClassName(compCtor)}'`,
            detail: detail
          });
          return;
        }
      }

      let comp = node.addComponent(compCtor);
      this.Undo.recordAddComponent( nodeID, comp, node._components.indexOf(comp) );
      this.Undo.commit();
    }
  },

  removeComponent ( nodeID, compID ) {
    let comp = cc.engine.getInstanceById(compID);
    if (!comp) {
      Editor.error( `Can not find component ${compID}` );
      return;
    }

    let node = cc.engine.getInstanceById(nodeID);
    if (!node) {
      Editor.error( `Can not find node ${nodeID}` );
      return;
    }

    let depend = node._getDependComponent(comp);
    if (depend) {
      Editor.Dialog.messageBox({
        type: 'warning',
        buttons: ['OK'],
        title: 'Warning',
        message: `Can\'t remove component '${cc.js.getClassName(comp)}'`,
        detail: `${cc.js.getClassName(depend)} depends on it`
      });
      return;
    }

    comp._destroyForUndo(() => {
      this.Undo.recordRemoveComponent( nodeID, comp, node._components.indexOf(comp) );
    });
    this.Undo.commit();
  },

  newProperty ( id, path, typeID ) {
    let inst = cc.engine.getInstanceById(id);
    if (!inst) {
      return;
    }

    try {
      let ctor = cc.js._getClassById(typeID);
      if ( ctor ) {
        let obj;
        try {
          obj = new ctor();
        } catch (e) {
          Editor.error(`Can not new property at ${path} for type ${cc.js.getClassName(ctor)}.\n${e.stack}`);
          return;
        }

        _Scene.Undo.recordObject(id);
        Editor.setDeepPropertyByPath(inst, path, obj, typeID);
        cc.engine.repaintInEditMode();
      }
    } catch (e) {
      Editor.warn(`Failed to new property ${inst.name} at ${path}, ${e.message}`);
    }
  },

  resetProperty ( id, path, typeID ) {
    let inst = cc.engine.getInstanceById(id);
    if (!inst) {
      return;
    }

    try {
      _Scene.Undo.recordObject(id);
      Editor.resetPropertyByPath(inst, path, typeID);
      cc.engine.repaintInEditMode();
    } catch (e) {
      Editor.warn(`Failed to reset property ${inst.name} at ${path}, ${e.message}`);
    }
  },

  setProperty ( id, path, typeID, value ) {
    let inst = cc.engine.getInstanceById(id);
    if (!inst) {
      return;
    }

    try {
      _Scene.Undo.recordObject(id);
      Editor.setPropertyByPath(inst, path, value, typeID);
      cc.engine.repaintInEditMode();

      _Scene.AnimUtils.recordNodeChanged([id]);
    } catch (e) {
      Editor.warn(`Failed to set property ${inst.name} to ${value} at ${path}, ${e.message}`);
    }
  },

  walk (root, includeSelf, cb) {
    if (!root) {
      return;
    }

    if (!cb) {
      Editor.warn('walk need a callback');
      return;
    }

    function traversal (node, cb) {
      let children = node.children;

      for (let i = 0; i < children.length; i++) {
        let child = children[i];

        if ( !cb( child ) ) {
          break;
        }

        traversal(child, cb);
      }
    }

    traversal(root, cb);

    if (includeSelf) {
      cb(root);
    }
  },

  // ==============================
  // prefab
  // ==============================

  createPrefab ( nodeID, baseUrl ) {
    let node = cc.engine.getInstanceById(nodeID);
    let prefab = Editor.PrefabUtils.createPrefabFrom(node);

    let url = Url.join(baseUrl, node.name + '.prefab');
    let json = Editor.serialize(prefab);

    Editor.sendRequestToCore('scene:create-prefab', url, json, (err, uuid) => {
      if (!err) {
        Editor.PrefabUtils.savePrefabUuid(node, uuid);
      }
    });
  },

  applyPrefab ( nodeID ) {
    let node = cc.engine.getInstanceById(nodeID);
    if (!node || !node._prefab) {
      return;
    }

    node = node._prefab.root;
    let prefabUuid = node._prefab.asset._uuid;
    let prefab = Editor.PrefabUtils.createPrefabFrom(node);
    Editor.PrefabUtils.savePrefabUuid(node, prefabUuid);

    let json = Editor.serialize(prefab);
    Editor.sendToCore('scene:apply-prefab', prefabUuid, json);
  },

  revertPrefab ( nodeID ) {
    let node = cc.engine.getInstanceById(nodeID);
    if (!node || !node._prefab) {
      return;
    }

    node = node._prefab.root;
    Editor.PrefabUtils.revertPrefab(node);
  },

  // ==============================
  // dump
  // ==============================

  dumpHierarchy () {
    // TODO: move code from Editor.getHierarchyDump to here
    return Editor.getHierarchyDump();
  },

  dumpNode ( nodeID ) {
    let node = cc.engine.getInstanceById(nodeID);

    // TODO: move code from Editor.getHierarchyDump to here
    return Editor.getNodeDump(node);
  },

  // ==============================
  // animation process
  // ==============================

  // TODO: by @2youyouo2, please move animation functions from scene.js to here

  // ==============================
  // selection
  // ==============================

  select ( ids ) {
    this.gizmosView.select(ids);
  },

  unselect ( ids ) {
    this.gizmosView.unselect(ids);
  },

  hoverin ( id ) {
    this.gizmosView.hoverin(id);
  },

  hoverout ( id ) {
    this.gizmosView.hoverout(id);
  },

  activate ( id ) {
    let node = cc.engine.getInstanceById(id);
    if (!node) {
      return;
    }

    _Scene.AnimUtils.activate(node);

    // normal process
    for (let i = 0; i < node._components.length; ++i) {
      let comp = node._components[0];
      if (comp.constructor._executeInEditMode && comp.isValid) {
        if (comp.onFocusInEditor) {
          callOnFocusInTryCatch(comp);
        }

        if (comp.constructor._playOnFocus) {
          cc.engine.animatingInEditMode = true;
        }
      }
    }
  },

  deactivate ( id ) {
    var node = cc.engine.getInstanceById(id);
    if (!node || !node.isValid) {
      return;
    }

    for (var i = 0; i < node._components.length; ++i) {
      var comp = node._components[0];
      if (comp.constructor._executeInEditMode && comp.isValid) {
        if (comp.onLostFocusInEditor) {
          callOnLostFocusInTryCatch(comp);
        }

        if (comp.constructor._playOnFocus) {
          cc.engine.animatingInEditMode = false;
        }
      }
    }
  },

  // ==============================
  // hit-test
  // ==============================

  hitTest ( x, y ) {
    // TODO
    // this.$.gizmosView.rectHitTest( x, y, 1, 1 );

    let worldHitPoint = this.view.pixelToWorld( cc.v2(x,y) );
    let minDist = Number.MAX_VALUE;
    let resultNode;

    let nodes = cc.engine.getIntersectionList( new cc.Rect(worldHitPoint.x, worldHitPoint.y, 1, 1) );
    nodes.forEach(node => {
      let aabb = node.getWorldBounds();
      // TODO: calculate the OBB center instead
      let dist = worldHitPoint.sub(aabb.center).magSqr();
      if ( dist < minDist ) {
        minDist = dist;
        resultNode = node;
      }
    });

    return resultNode;
  },

  rectHitTest ( x, y, w, h ) {
    let v1 = this.view.pixelToWorld( cc.v2(x,y) );
    let v2 = this.view.pixelToWorld( cc.v2(x+w,y+h) );
    let worldRect = cc.Rect.fromMinMax(v1,v2);

    let results = [];
    let nodes = cc.engine.getIntersectionList(worldRect);
    nodes.forEach(node => {
      results.push(node);
    });

    return results;
  }

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
