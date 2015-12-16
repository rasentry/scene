(function () {
    'use strict';

    const Url = require('fire-url');

    let _clipboardCache = {
        data: null,
        hash: '',   // used to verify whether the detail data is match with current clipboard
    };

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

    Editor.registerPanel('scene.panel', {
        behaviors: [ EditorUI.droppable ],

        hostAttributes: {
            'droppable': 'asset',
        },

        listeners: {
            'drop-area-enter': '_onDropAreaEnter',
            'drop-area-leave': '_onDropAreaLeave',
            'drop-area-accept': '_onDropAreaAccept',

            'engine-ready': '_onEngineReady',

            'scene-view-ready': '_onSceneViewReady',
            'scene-view-init-error': '_onSceneViewInitError',

            'panel-show': '_onPanelResize',
            'resize': '_onPanelResize'
        },

        properties: {
            transformTool: {
                type: String,
                value: 'move',
            },

            coordinate: {
                type: String,
                value: 'local',
            },

            pivot: {
                type: String,
                value: 'pivot',
            },
        },

        created: function () {
            this._viewReady = false;
            this._ipcList = [];
            this._thisOnCopy = null;
            this._thisOnPaste = null;
            this._copyingIds = null;
            this._pastingId = '';

            console.time('scene:reloading');

            // change scene states
            Editor.sendToAll('scene:reloading');
        },

        ready: function () {
            // beforeunload event
            window.addEventListener('beforeunload', event => {
                let res = this.confirmCloseScene();
                switch ( res ) {
                // save
                case 0:
                    _Scene.saveScene();
                    Editor.Selection.clear('node');
                    event.returnValue = true;
                    return;

                // cancel
                case 1:
                    Editor.remote._runDashboard = false;
                    event.returnValue = false;
                    return;

                // don't save
                case 2:
                    Editor.Selection.clear('node');
                    event.returnValue = true;
                    return;
                }
            });

            // init droppable
            this._initDroppable(this.$.dropArea);

            _Scene.init(this.$.sceneView, this.$.sceneView.$.gizmosView);

            // init scene-view
            this.$.sceneView.init();

            // A VERY HACK SOLUTION
            // TODO: add panel-close event
            var Ipc = require('ipc');
            Ipc.on('panel:undock', (panelID) => {
                if ( panelID !== 'scene.panel' ) {
                    return;
                }

                _Scene.EngineEvents.unregister();
            });
        },

        attached: function () {
            this._thisOnCopy = this._onCopy.bind(this);
            document.addEventListener('copy', this._thisOnCopy);

            this._thisOnPaste = this._onPaste.bind(this);
            document.addEventListener('paste', this._thisOnPaste);
        },

        detached: function () {
            document.removeEventListener('copy', this._thisOnCopy);
            document.removeEventListener('paste', this._thisOnPaste);
        },

        _onPanelResize: function () {
            // debounce write for 10ms
            if ( this._resizeDebounceID ) {
                return;
            }

            this._resizeDebounceID = setTimeout(() => {
                this._resizeDebounceID = null;
                this.$.sceneView._resize();
            }, 10);
        },

        // menu messages
        selectMove: function ( event ) {
            if ( event ) {
                event.stopPropagation();
            }

            this.transformTool = 'move';
        },

        selectRect: function ( event ) {
            if ( event ) {
                event.stopPropagation();
            }

            this.transformTool = 'rect';
        },

        selectRotate: function ( event ) {
            if ( event ) {
                event.stopPropagation();
            }

            this.transformTool = 'rotate';
        },

        selectScale: function ( event ) {
            if ( event ) {
                event.stopPropagation();
            }

            this.transformTool = 'scale';
        },

        deleteCurrentSelected: function ( event ) {
            if ( event ) {
                event.stopPropagation();
            }

            let ids = Editor.Selection.curSelection('node');
            _Scene.deleteNodes(ids);
        },

        duplicateCurrentSelected: function ( event ) {
            if ( event ) {
                event.stopPropagation();
            }

            let ids = Editor.Selection.curSelection('node');
            _Scene.duplicateNodes(ids);
        },

        confirmCloseScene: function () {
            var dirty = _Scene.Undo.dirty();
            if ( dirty ) {
                var name = 'New Scene';
                var url = 'db://assets/New Scene.fire';
                var currentSceneUuid = Editor.remote.currentSceneUuid;

                if ( currentSceneUuid ) {
                    url = Editor.assetdb.remote.uuidToUrl(currentSceneUuid);
                    name = Url.basename(url);
                }

                return Editor.Dialog.messageBox({
                    type: 'warning',
                    buttons: ['Save','Cancel','Don\'t Save'],
                    title: 'Save Scene Confirm',
                    message: name + ' has changed, do you want to save it?',
                    detail: 'Your changes will be lost if you close this item without saving.'
                } );
            }

            //
            return 2;
        },

        // copy & paste

        _onCopy: function ( event ) {
            //var copyingNode = this.$.sceneView.contains(document.activeElement);
            if (!this._copyingIds) {
                return;
            }

            event.stopPropagation();
            event.preventDefault();

            event.clipboardData.clearData();
            if ( !this._copyingIds.length ) {
                this._copyingIds = null;
                return;
            }

            var copyInfo = {
                nodeIDs: this._copyingIds
            };
            event.clipboardData.setData('text/fireball', JSON.stringify(copyInfo));
            this._copyingIds = null;
        },

        _onPaste: function ( event ) {
            //var copyingNode = this.$.sceneView.contains(document.activeElement);
            if (!this._pastingId) {
                return;
            }

            var data = event.clipboardData.getData('text/fireball');
            if (!data) {
                event.stopPropagation();
                event.preventDefault();

                var copyed = JSON.parse(data).nodeIDs;
                var hash = copyed.join(', ');
                if (_clipboardCache.hash === hash) {
                    var parent;
                    if (this._pastingId) {
                        parent = cc.engine.getInstanceById(this._pastingId);
                    }

                    if (!parent) {
                        parent = cc.director.getScene();
                    }

                    var node;
                    var nodes = _clipboardCache.data.nodes;

                    for (var id in nodes) {
                        node = cc.instantiate(nodes[id]);
                        node.parent = parent;
                    }

                    // select the last one
                    Editor.Selection.select('node', node.uuid);
                    return;
                }
            }

            // clear mismatched data
            _clipboardCache.hash = '';
            _clipboardCache.data = null;

            this._pastingId = '';
        },

        // drag & drop

        _onDropAreaEnter: function ( event ) {
            event.stopPropagation();
        },

        _onDropAreaLeave: function ( event ) {
            event.stopPropagation();
        },

        _onDropAreaAccept: function ( event ) {
            event.stopPropagation();

            let uuids = event.detail.dragItems;
            let x = event.detail.offsetX;
            let y = event.detail.offsetY;

            _Scene.createNodesAt( uuids, x, y );
        },

        _onDragOver: function ( event ) {
            var dragType = EditorUI.DragDrop.type(event.dataTransfer);
            if ( dragType !== 'asset' ) {
                EditorUI.DragDrop.allowDrop( event.dataTransfer, false );
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            EditorUI.DragDrop.allowDrop( event.dataTransfer, true );
            EditorUI.DragDrop.updateDropEffect( event.dataTransfer, 'copy' );
        },

        _onEngineReady: function () {
            // register engine events, after engine ready and before scene load
            _Scene.EngineEvents.register();
        },

        _onSceneViewReady: function () {
            this._viewReady = true;
            this.$.loader.hidden = true;
            _Scene.Undo.clear();

            Editor.sendToAll('scene:ready');

            console.timeEnd('scene:reloading');
        },

        _onSceneViewInitError: function (event) {
            let err = event.args[0];
            Editor.failed(`Failed to init scene: ${err.stack}`);

            this.$.loader.hidden = true;
        },

        _loadScene ( uuid ) {
            this.$.loader.hidden = false;
            Editor.sendToAll('scene:reloading');
            _Scene.loadSceneByUuid(uuid, err => {
                if (err) {
                    this.fire('scene-view-init-error', err);
                    return;
                }
                this.fire('scene-view-ready');
            });
        },

        'panel:run': function ( argv ) {
            if ( !argv || !argv.uuid ) {
                return;
            }

            let res = this.confirmCloseScene();
            switch ( res ) {
                // save
                case 0:
                _Scene.saveScene(() => {
                    this._loadScene(argv.uuid);
                });
                return;

                // cancel
                case 1:
                return;

                // don't save
                case 2:
                this._loadScene(argv.uuid);
                return;
            }
        },

        'editor:dragstart': function () {
            this.$.dropArea.hidden = false;
        },

        'editor:dragend': function () {
            this.$.dropArea.hidden = true;
        },

        'editor:start-recording': function () {
            _Scene.AnimUtils._recording = true;
            // let data = Editor._recordObject(_Scene.AnimUtils.curRootNode);
            // TODO:
        },

        'editor:stop-recording': function () {
            _Scene.AnimUtils._recording = false;
            // Editor._restoreObject(data);
            // TODO:
        },

        'scene:is-ready': function ( sessionID ) {
            Editor.sendToWindows('scene:is-ready:reply', sessionID, this._viewReady );
        },

        'scene:new-scene': function () {
            this.$.loader.hidden = false;
            Editor.sendToAll('scene:reloading');
            _Scene.newScene();

            this.fire('scene-view-ready');
        },

        'scene:play-on-device': function () {
            _Scene.stashScene(() => {
                Editor.sendToCore( 'app:play-on-device' );
            });
        },

        'scene:reload-on-device': function () {
            _Scene.stashScene(() => {
                Editor.sendToCore( 'app:reload-on-device' );
            });
        },

        'scene:query-hierarchy': function ( queryID ) {
            if (!cc.engine.isInitialized) {
                return Editor.sendToWindows( 'scene:reply-query-hierarchy', queryID, '', [] );
            }
            let nodes = _Scene.dumpHierarchy();
            let sceneUuid = _Scene.currentScene().uuid;
            Editor.sendToWindows( 'scene:reply-query-hierarchy', queryID, sceneUuid, nodes );
        },

        'scene:query-node': function ( queryID, nodeID ) {
            let dump = _Scene.dumpNode(nodeID);
            dump = JSON.stringify(dump); // 改成发送字符串，以免字典的顺序发生改变
            Editor.sendToWindows( 'scene:reply-query-node', queryID, dump );
        },

        'scene:query-node-info': function ( sessionID, nodeOrCompID, typeID ) {
            let node = null;
            let nodeOrComp = cc.engine.getInstanceById(nodeOrCompID);

            if ( nodeOrComp ) {
                if ( nodeOrComp instanceof cc.Component ) {
                    node = nodeOrComp.node;
                } else {
                    node = nodeOrComp;
                }
            }

            let comp = null;
            if ( node && typeID !== 'cc.Node' ) {
                comp = node.getComponent(cc.js._getClassById(typeID));
            }

            Editor.sendToWindows( 'scene:query-node-info:reply', sessionID, {
                name: node ? node.name : '',
                missed: nodeOrComp === null,
                nodeID: node ? node.uuid : null,
                compID: comp ? comp.uuid : null,
            });
        },

        'scene:query-node-functions': function ( sessionID, nodeID ) {
            var node = cc.engine.getInstanceById(nodeID);
            var dump = Editor.getNodeFunctions(node);

            Editor.sendToWindows('scene:query-node-functions:reply', sessionID, dump);
        },

        'scene:query-animation-node': function (queryID, nodeID, childName) {
            var node = cc.engine.getInstanceById(nodeID);

            var animationNode = node;
            while (animationNode) {
                var isAnimationNode = animationNode.getComponent(cc.Animation);
                if (isAnimationNode) {
                    break;
                }

                if (animationNode.parent instanceof cc.Scene) {
                    animationNode = node;
                    break;
                }

                animationNode = animationNode.parent;
            }

            var dump = Editor.getAnimationNodeDump(animationNode, childName);
            Editor.sendToWindows('scene:reply-animation-node', queryID, dump );
        },

        'scene:is-child-class-of': function ( sessionID, className, baseClassName ) {
            let sub = cc.js._getClassById(className);
            let base = cc.js._getClassById(baseClassName);
            let result = cc.isChildClassOf(sub, base);
            Editor.sendToWindows('scene:is-child-class-of:reply', sessionID, result);
        },

        'scene:new-property': function ( info ) {
            var nodeOrComp = cc.engine.getInstanceById(info.id);
            if (nodeOrComp) {
                try {
                    var id = info.type;
                    var ctor = cc.js._getClassById(id);
                    if ( ctor ) {
                        var obj;
                        try {
                            obj = new ctor();
                        }
                        catch (e) {
                            Editor.error('Can not create new info.type directly.\nInner message: ' + e.stack);
                            return;
                        }
                        Editor.setDeepPropertyByPath(nodeOrComp, info.path, obj, info.type);
                        cc.engine.repaintInEditMode();
                    }
                }
                catch (e) {
                    Editor.warn('Failed to new property %s of %s to %s, ' + e.message,
                                info.path, nodeOrComp.name, info.value);
                }
            }
        },

        'scene:reset-property': function ( info ) {
            var nodeOrComp = cc.engine.getInstanceById(info.id);
            if (nodeOrComp) {
                //
                try {
                    _Scene.Undo.recordObject(info.id);
                    Editor.resetPropertyByPath(nodeOrComp, info.path, info.type);
                    cc.engine.repaintInEditMode();
                }
                catch (e) {
                    Editor.warn('Failed to reset property %s of %s, ' + e.message,
                                info.path, nodeOrComp.name);
                }
            }
        },

        'scene:set-property': function ( info ) {
            var nodeOrComp = cc.engine.getInstanceById(info.id);
            if (nodeOrComp) {
                // 兼容旧版 Inspector
                if (info.mixinType) {
                    nodeOrComp = nodeOrComp.getComponent(info.mixinType);
                    if (!cc.isValid(nodeOrComp)) {
                        return;
                    }
                }
                //
                try {
                    _Scene.Undo.recordObject(info.id);
                    Editor.setPropertyByPath(nodeOrComp, info.path, info.value, info.type);
                    cc.engine.repaintInEditMode();
                }
                catch (e) {
                    Editor.warn('Failed to set property %s of %s to %s, ' + e.message,
                                info.path, nodeOrComp.name, info.value);
                }
            }
        },

        'scene:add-component': function ( nodeID, compID ) {
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
                        return Editor.error(`Can not find cc.Component in the script ${compID}.`);
                    } else {
                        return Editor.error(`Failed to get component ${compID}`);
                    }
                }
                //
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
                _Scene.Undo.recordAddComponent( nodeID, comp, node._components.indexOf(comp) );
                _Scene.Undo.commit();
            }
        },

        'scene:remove-component': function ( nodeID, compID ) {
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
            _Scene.Undo.recordRemoveComponent( nodeID, comp, node._components.indexOf(comp) );
            _Scene.Undo.commit();

            comp.destroy();
        },

        'scene:create-nodes-by-uuids': function ( uuids, parentID ) {
            _Scene.createNodes( uuids, parentID );
        },

        'scene:create-node-by-classid': function ( name, classID, referenceID, isSibling ) {
            _Scene.createNodeByClassID( name, classID, referenceID, isSibling );
        },

        'scene:create-node-by-prefab': function ( name, prefabID, referenceID, isSibling ) {
            _Scene.createNodeByPrefab( name, prefabID, referenceID, isSibling );
        },

        'scene:move-nodes': function ( ids, parentID, nextSiblingId ) {
            _Scene.moveNodes( ids, parentID, nextSiblingId );
        },

        'scene:delete-nodes': function ( ids ) {
            _Scene.deleteNodes(ids);
        },

        'scene:copy-nodes': function (ids) {
            var nodes = ids.map(x => cc.engine.getInstanceById(x)).filter(x => !!x);
            nodes = getTopLevelNodes(nodes).filter(x => !!x);
            this._copyingIds = nodes.map(x => x.uuid);

            var copyData = {
                sceneId: cc.director.getScene().uuid,
                nodes: {}
            };

            nodes.forEach(x => {
                // save current values
                copyData.nodes[x.uuid] = cc.instantiate(x);
            });

            // save real data to cache
            _clipboardCache.hash = this._copyingIds.join(', ');
            _clipboardCache.data = copyData;

            // Emit copy event on this web contents,
            // so that we can access to the clipboard without pressing [Command + C]
            require('remote').getCurrentWebContents().copy();
        },

        'scene:paste-nodes': function (parentId) {
            if (!parentId) {
                parentId = cc.director.getScene().uuid;
            }
            this._pastingId = parentId;

            // Emit paste event on this web contents
            // so that we can access to the clipboard without pressing [Command + P]
            require('remote').getCurrentWebContents().paste();
        },

        'scene:duplicate-nodes': function ( ids ) {
            _Scene.duplicateNodes(ids);
        },

        'scene:stash-and-reload': function () {
            _Scene.stashScene(() => {
                this.reload();
            });
        },

        'scene:soft-reload': function ( compiled ) {
            _Scene.softReload(compiled);
        },

        'scene:create-prefab': function ( id, baseUrl ) {
            _Scene.createPrefab(id, baseUrl);
        },

        'scene:apply-prefab': function ( id ) {
            _Scene.applyPrefab(id);
        },

        'scene:revert-prefab': function ( id ) {
            _Scene.revertPrefab(id);
        },

        'scene:stash-and-save': function () {
            _Scene.saveScene();
        },

        'scene:saved': function () {
            _Scene.Undo.save();
        },

        'scene:undo': function () {
            _Scene.Undo.undo();
        },

        'scene:redo': function () {
            _Scene.Undo.redo();
        },

        'scene:undo-record': function ( id, desc ) {
            _Scene.Undo.recordObject( id, desc );
        },

        'scene:undo-commit': function () {
            _Scene.Undo.commit();
        },

        'scene:undo-cancel': function () {
            _Scene.Undo.cancel();
        },

        'scene:animation-state-changed': function (info) {
            _Scene.AnimUtils.setCurrentPlayState(info);
        },

        'scene:query-animation-time': function (sessionID, info) {
            var timeInfo = _Scene.AnimUtils.getAnimationTime(info);

            Editor.sendToWindows( 'scene:reply-animation-time', sessionID, timeInfo);
        },

        'scene:animation-time-changed': function (info) {
            _Scene.AnimUtils.setAnimationTime(info);
        },

        'scene:animation-clip-changed': function (info) {
            _Scene.AnimUtils.updateClip(info);
        },

        'scene:new-clip': function (info) {
            _Scene.AnimUtils.addClip(info);
        },

        'scene:animation-current-clip-changed': function (info) {
            _Scene.AnimUtils.changeCurrentClip(info);
        },

        'selection:selected': function ( type, ids ) {
            if ( type !== 'node' ) {
                return;
            }
            _Scene.select(ids);
        },

        'selection:unselected': function ( type, ids ) {
            if ( type !== 'node' ) {
                return;
            }
            _Scene.unselect(ids);
        },

        'selection:activated': function ( type, id ) {
            if ( type !== 'node' || !id ) {
                return;
            }

            _Scene.activate(id);
        },

        'selection:deactivated': function ( type, id ) {
            if ( type !== 'node' ) {
                return;
            }

            _Scene.deactivate(id);
        },

        'selection:hoverin': function ( type, id ) {
            if ( type !== 'node' ) {
                return;
            }
            _Scene.hoverin(id);
        },

        'selection:hoverout': function ( type, id ) {
            if ( type !== 'node' ) {
                return;
            }
            _Scene.hoverout(id);
        },

        'scene:show-trajectory-gizmo': function ( info ) {
            _Scene.AnimUtils.showTrajectoryGizmo(info);
        },

        'scene:hide-trajectory-gizmo': function ( info ) {
            _Scene.AnimUtils.hideTrajectoryGizmo(info);
        },

        'scene:trajectory-state-changed': function (info) {
            Editor.gizmos.trajectory.state = info.state;
        }
    });
})();
