(function () {
'use strict';

// var Path = require('fire-path');
// var Url = require('fire-url');

Editor.registerElement({
    listeners: {
        'mousedown': '_onMouseDown',
        'mousewheel': '_onMouseWheel',
        'mousemove': '_onMouseMove',
        'mouseleave': '_onMouseLeave',
        'keydown': '_onKeyDown',
        'keyup': '_onKeyUp'
    },

    properties: {
        scale: {
            type: Number,
            value: 1.0,
        },

        transformTool: {
            type: String,
            value: 'move',
            notify: true,
            observer: 'setTransformTool',
        },

        coordinate: {
            type: String,
            value: 'local',
            notify: true,
            observer: 'setCoordinate',
        },

        pivot: {
            type: String,
            value: 'pivot',
            notify: true,
            observer: 'setPivot',
        },
    },

    ready: function () {
        this._inited = false;

        var mappingH = [0, 1, 1];
        var mappingV = [1, 0, 1];

        // grid
        this.$.grid.setScaleH( [5,2], 0.01, 1000 );
        this.$.grid.setMappingH( mappingH[0], mappingH[1], mappingH[2] );

        this.$.grid.setScaleV( [5,2], 0.01, 1000 );
        this.$.grid.setMappingV( mappingV[0], mappingV[1], mappingV[2] );

        this.$.grid.setAnchor( 0.5, 0.5 );

        // add capture mousedown event listener to handle the bigger priority event
        this.addEventListener('mousedown', this._onCaptureMousedown.bind(this), true);
    },

    _T: function (text_id) {
        return Editor.T(text_id);
    },

    detached: function () {
        clearInterval(this._initTimer);
    },

    init: function () {
        this._initTimer = setInterval(() => {
            // do nothing if bounding rect is zero
            let bcr = this.getBoundingClientRect();
            if ( bcr.width === 0 && bcr.height === 0 ) {
                return;
            }

            clearInterval(this._initTimer);
            this._initEngine(() => {
                // init gizmos
                this.$.gizmosView.sceneToPixel = this.sceneToPixel.bind(this);
                this.$.gizmosView.worldToPixel = this.worldToPixel.bind(this);
                this.$.gizmosView.pixelToScene = this.pixelToScene.bind(this);
                this.$.gizmosView.pixelToWorld = this.pixelToWorld.bind(this);

                //
                this._inited = true;
                this._resize();
            });
        }, 100);
    },

    initPosition: function ( x, y, scale ) {
        this.scale = scale;

        //
        this.$.grid.xAxisSync ( x, scale );
        this.$.grid.yAxisSync ( y, scale );
        this.$.grid.repaint();

        //
        this.$.gizmosView.scale = scale;

        // override some attributes to make the transform of Scene not serializable
        var SceneTransformProps = ['_position', '_rotationX', '_rotationY', '_scaleX', '_scaleY', '_skewX', '_skewY'];
        SceneTransformProps.forEach(function (prop) {
            var attr = cc.Class.attr(cc.Scene, prop);
            attr = cc.js.addon({
                serializable: false
            }, attr);
            cc.Class.attr(cc.Scene.prototype, prop, attr);
        });

        var scene = cc.director.getScene();
        scene.scale = cc.v2( this.$.grid.xAxisScale, this.$.grid.yAxisScale );
        scene.setPosition(cc.v2( this.$.grid.xDirection * this.$.grid.xAxisOffset,
                                 this.$.grid.yDirection * this.$.grid.yAxisOffset ));
        cc.engine.repaintInEditMode();
    },

    _resize: function () {
        if ( !this._inited ) {
            return;
        }

        // do nothing if bounding rect is zero
        let bcr = this.getBoundingClientRect();
        if ( bcr.width === 0 && bcr.height === 0 ) {
            return;
        }

        // resize grid
        this.$.grid.resize();
        this.$.grid.repaint();

        // resize gizmos
        this.$.gizmosView.resize();

        // resize engine
        cc.view.setCanvasSize(bcr.width, bcr.height);
        cc.view.setDesignResolutionSize(bcr.width, bcr.height);

        // sync axis offset and scale from grid
        var scene = cc.director.getScene();
        scene.scale = cc.v2(this.$.grid.xAxisScale, this.$.grid.yAxisScale);
        scene.setPosition(cc.v2(this.$.grid.xDirection * this.$.grid.xAxisOffset,
                                this.$.grid.yDirection * this.$.grid.yAxisOffset));
        cc.engine.repaintInEditMode();
    },

    _initEngine: function ( cb ) {
        if ( cc.engine.isInitialized ) {
            // 从外部窗口 attach 回到主窗口时需要重置所有 engine 相关状态
            cc.engine.reset();
            Editor.Sandbox.reset();
        }

        // init engine
        var canvasEL = this.$['engine-canvas'];
        var bcr = this.getBoundingClientRect();
        canvasEL.width  = bcr.width;
        canvasEL.height = bcr.height;

        var opts = {
            id: 'engine-canvas',
            width: bcr.width,
            height: bcr.height,
            designWidth: bcr.width,
            designHeight: bcr.height
        };

        cc.engine.init(opts, () => {
            this.fire('engine-ready');

            _Scene.initScene(err => {
                if (err) {
                    this.fire('scene-view-init-error', err);
                    return;
                }

                this.fire('scene-view-ready');

                if ( cb ) {
                    cb ();
                }
            });
        });
    },

    adjustToCenter: function ( margin ) {
        var bcr = this.getBoundingClientRect();
        var fitWidth = bcr.width - margin * 2;
        var fitHeight = bcr.height - margin * 2;

        var designSize = cc.engine.getDesignResolutionSize();
        var designWidth = designSize.width;
        var designHeight = designSize.height;

        if ( designWidth <= fitWidth && designHeight <= fitHeight ) {
            this.initPosition(
                this.$.grid.xDirection * (bcr.width - designWidth)/2,
                this.$.grid.yDirection * (bcr.height - designHeight)/2,
                1.0
            );
        }
        else {
            var result = Editor.Utils.fitSize(
                designWidth,
                designHeight,
                fitWidth,
                fitHeight
            );
            // move x
            if ( result[0] < result[1] ) {
                this.initPosition(
                    this.$.grid.xDirection * (bcr.width - result[0])/2,
                    this.$.grid.yDirection * (bcr.height - result[1])/2,
                    result[0]/designWidth
                );
            }
            // move y
            else {
                this.initPosition(
                    this.$.grid.xDirection * (bcr.width - result[0])/2,
                    this.$.grid.yDirection * (bcr.height - result[1])/2,
                    result[1]/designHeight
                );
            }
        }
    },

    sceneToPixel: function ( pos ) {
        return cc.v2(
            this.$.grid.valueToPixelH(pos.x),
            this.$.grid.valueToPixelV(pos.y)
        );
    },

    worldToPixel: function (pos) {
        var scene = cc.director.getScene();
        var scenePos = scene.convertToNodeSpaceAR(pos);
        return this.sceneToPixel( scenePos );
    },

    pixelToScene: function (pos) {
        return cc.v2(
            this.$.grid.pixelToValueH(pos.x),
            this.$.grid.pixelToValueV(pos.y)
        );
    },

    pixelToWorld: function (pos) {
        var scene = cc.director.getScene();
        return cc.v2(scene.convertToWorldSpaceAR(this.pixelToScene(pos)));
    },

    // DISABLE
    // play: function () {
    //     var self = this;
    //     //
    //     _Scene.playScene(function (err) {
    //         if (err) {
    //             this.fire('scene:play-error', err);
    //             return;
    //         }
    //         this.fire('scene:playing');
    //     });
    // },

    _onCaptureMousedown: function ( event ) {
        // panning
        if ( (event.which === 1 && event.shiftKey) ||
             event.which === 2
           )
        {
            event.stopPropagation();

            this.style.cursor = '-webkit-grabbing';
            EditorUI.startDrag(
                '-webkit-grabbing',
                event,

                // move
                function ( event, dx, dy, offsetx, offsety ) {
                    this.$.grid.pan( dx, dy );
                    this.$.grid.repaint();

                    var scene = cc.director.getScene();
                    scene.setPosition(cc.v2(this.$.grid.xDirection * this.$.grid.xAxisOffset,
                                            this.$.grid.yDirection * this.$.grid.yAxisOffset));
                    cc.engine.repaintInEditMode();
                }.bind(this),

                // end
                function ( event, dx, dy, offsetx, offsety ) {
                    if ( event.shiftKey )
                        this.style.cursor = '-webkit-grab';
                    else
                        this.style.cursor = '';
                }.bind(this)
            );

            return;
        }
    },

    _onMouseDown: function ( event ) {
        event.stopPropagation();

        // process rect-selection
        if ( event.which === 1 ) {
            var toggleMode = false;
            var lastSelection = Editor.Selection.curSelection('node');
            if ( event.metaKey || event.ctrlKey ) {
                toggleMode = true;
            }

            var startx = event.offsetX;
            var starty = event.offsetY;

            EditorUI.startDrag(
                'default',
                event,

                // move
                function ( event, dx, dy, offsetx, offsety ) {
                    var magSqr = offsetx*offsetx + offsety*offsety;
                    if ( magSqr < 2.0 * 2.0 ) {
                        return;
                    }

                    var x = startx;
                    var y = starty;

                    if ( offsetx < 0.0 ) {
                        x += offsetx;
                        offsetx = -offsetx;
                    }
                    if ( offsety < 0.0 ) {
                        y += offsety;
                        offsety = -offsety;
                    }

                    this.$.gizmosView.updateSelectRect( x, y, offsetx, offsety );

                    var nodes = _Scene.rectHitTest( x, y, offsetx, offsety );
                    var i, ids;

                    // toggle mode will always act added behaviour when we in rect-select-state
                    if ( toggleMode ) {
                        ids = lastSelection.slice();

                        for ( i = 0; i < nodes.length; ++i ) {
                            if ( ids.indexOf(nodes[i].uuid) === -1 )
                                ids.push( nodes[i].uuid );
                        }
                    }
                    else {
                        ids = [];

                        for ( i = 0; i < nodes.length; ++i ) {
                            ids.push( nodes[i].uuid );
                        }
                    }
                    Editor.Selection.select ( 'node', ids, true, false );
                }.bind(this),

                // end
                function ( event, dx, dy, offsetx, offsety ) {
                    var magSqr = offsetx*offsetx + offsety*offsety;
                    if ( magSqr < 2.0 * 2.0 ) {
                        var node = _Scene.hitTest( startx, starty );

                        if ( toggleMode ) {
                            if ( node ) {
                                if ( lastSelection.indexOf(node.uuid) === -1 ) {
                                    Editor.Selection.select ( 'node', node.uuid, false, true );
                                }
                                else {
                                    Editor.Selection.unselect ( 'node', node.uuid, true );
                                }
                            }
                        }
                        else {
                            if ( node ) {
                                Editor.Selection.select ( 'node', node.uuid, true, true );
                            }
                            else {
                                Editor.Selection.clear ( 'node' );
                            }
                        }
                    }
                    else {
                        Editor.Selection.confirm ();
                        this.$.gizmosView.fadeoutSelectRect();
                    }
                }.bind(this)
            );
        }
    },

    _onMouseWheel: function ( event ) {
        event.stopPropagation();

        var newScale = Editor.Utils.smoothScale(this.scale, event.wheelDelta);
        newScale = Math.clamp(newScale,
                              this.$.grid.hticks.minValueScale,
                              this.$.grid.hticks.maxValueScale);

        //
        this.scale = newScale;

        //
        this.$.grid.xAxisScaleAt ( event.offsetX, newScale );
        this.$.grid.yAxisScaleAt ( event.offsetY, newScale );
        this.$.grid.repaint();

        //
        this.$.gizmosView.scale = newScale;

        //
        var scene = cc.director.getScene();
        scene.scale = cc.v2( this.$.grid.xAxisScale, this.$.grid.yAxisScale );
        scene.setPosition(cc.v2(this.$.grid.xDirection * this.$.grid.xAxisOffset,
                                this.$.grid.yDirection * this.$.grid.yAxisOffset));
        cc.engine.repaintInEditMode();
    },

    _onMouseMove: function ( event ) {
        event.stopPropagation();

        var node = _Scene.hitTest( event.offsetX, event.offsetY );
        var id = node ? node.uuid : null;
        Editor.Selection.hover( 'node', id );
    },

    _onMouseLeave: function ( event ) {
        Editor.Selection.hover( 'node', null );
    },

    _onKeyDown: function ( event ) {
        event.stopPropagation();

        if ( Editor.KeyCode(event.which) === 'shift' ) {
            this.style.cursor = '-webkit-grab';
        }
    },

    _onKeyUp: function ( event ) {
        event.stopPropagation();

        if ( Editor.KeyCode(event.which) === 'shift' ) {
            this.style.cursor = '';
        }
    },

    setTransformTool: function (transformTool) {
        this.$.gizmosView.transformTool = transformTool || this.transformTool;
        cc.engine.repaintInEditMode();
    },

    setCoordinate: function (coordinate) {
        this.$.gizmosView.coordinate = coordinate || this.coordinate;
        cc.engine.repaintInEditMode();
    },

    setPivot: function (pivot) {
        this.$.gizmosView.pivot = pivot || this.pivot;
        cc.engine.repaintInEditMode();
    },
});

})();
