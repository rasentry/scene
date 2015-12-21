'use strict';

(() => {
  let AnimUtils = {
    _recording: false,
    _recordingData: {},

    curRootNode: null,
    curEditNode: null,
    curAnim: null,
    curAnimState: null,
    curTime: -1,

    isPlaying() {
      var curAnimState = this.curAnimState;
      if (!curAnimState) return false;
      return curAnimState.isPlaying && !curAnimState.isPaused;
    },

    setAnimationTime(info) {
      let anim = this.curAnim;
      let aniState = this.curAnimState;

      if (!anim || !aniState) {
        return;
      }

      let clipName = info.clip;

      if (!aniState.isPlaying) {
        anim.play(clipName);
        anim.pause(clipName);
      }

      let time = info.time;
      this.curTime = time;

      if (time > aniState.duration) {
        time = aniState.duration;
      }

      anim.setCurrentTime(time, clipName);
      anim.sample();

      cc.engine.repaintInEditMode();
    },

    getAnimationTime(info) {
      let aniState = this.curAnimState;

      if (!aniState) {
        return;
      }

      let wrappedInfo = aniState.getWrappedInfo(aniState.time);

      return {
        clip: info.clip,
        time: wrappedInfo.time,
        isPlaying: this.isPlaying()
      };
    },

    setCurrentPlayState(info) {
      let anim = this.curAnim;
      let aniState = this.curAnimState;

      if (!anim || !aniState) {
        return;
      }

      let state = info.state;
      let clipName = info.clip;

      if (state === 'play') {
        anim.play(clipName);
        cc.engine.animatingInEditMode = true;
      }
      else if (state === 'pause') {
        if (aniState.isPlaying) {
          anim.pause(clipName);
        }
        cc.engine.animatingInEditMode = false;
      }
      else if (state === 'stop') {
        anim.stop(clipName);
        cc.engine.animatingInEditMode = false;
      }
    },

    addClip(info) {
      let node = this.curEditNode;
      if (!node) {
        return;
      }

      cc.AssetLibrary.loadAsset(info.clipUuid, (err, clip) => {
        let anim = node.getComponent(cc.Animation);
        anim.addClip(clip);
      });
    },

    updateClip(info) {
      let anim = this.curAnim;
      if (!anim) return;

      cc.AssetLibrary.loadJson(info.data, (err, clip) => {
        if (err) {
          Editor.error(err);
          return;
        }

        // need to update animation time
        anim.setCurrentTime(info.time, info.clip);

        anim._updateClip(clip);
        cc.engine.repaintInEditMode();
      });
    },

    changeCurrentClip(info) {
      if (!info.clip) {
        this.curAnim = null;
        this.curAnimState = null;
        return;
      }

      let curRootNode = this.curRootNode;
      if (!curRootNode) return;

      let anim = this.curAnim = curRootNode.getComponent(cc.Animation);
      let clipName = info.clip;

      this.curAnimState = anim.getAnimationState(clipName);
      anim.play(clipName);
      anim.pause(clipName);
    },

    // trajectory

    showTrajectoryGizmo(info) {
      let gizmosView = _Scene.gizmosView;
      let curRootNode = this.curRootNode;

      if (!curRootNode) {
        return;
      }

      cc.AssetLibrary.loadAsset(info.clipUuid, (err, clip) => {
        for (let i = 0; i < info.nodeIds.length; i++) {
          let node = cc.engine.getInstanceById(info.nodeIds[i]);
          if (!node) continue;

          if (!node.trajectoryGizmo) {
            node.trajectoryGizmo = new Editor.gizmos.trajectory(gizmosView, node);
          }
          node.trajectoryGizmo.show(curRootNode, clip, info.childPaths[i]);
        }
      });
    },

    hideTrajectoryGizmo(info) {
      for (let i = 0; i < info.nodeIds.length; i++) {
        let node = cc.engine.getInstanceById(info.nodeIds[i]);
        if (node && node.trajectoryGizmo) {
          node.trajectoryGizmo.hide();
        }
      }
    },

    // selection

    activate(node) {
      this.curEditNode = node;
      this.curRootNode = null;

      let animationNode = node;
      let isAnimationNode = animationNode.getComponent(cc.Animation);

      while (animationNode && !(animationNode instanceof cc.Scene)) {
        isAnimationNode = animationNode.getComponent(cc.Animation);
        if (isAnimationNode) {
          this.curRootNode = animationNode;
          break;
        }

        animationNode = animationNode.parent;
      }
    },

    getAnimationNodeDump (nodeId) {
      var node = cc.engine.getInstanceById(nodeId);

      var rootNode = node;
      while (rootNode) {
          var isAnimationNode = rootNode.getComponent(cc.Animation);
          if (isAnimationNode) {
              break;
          }

          if (rootNode.parent instanceof cc.Scene) {
              rootNode = node;
              break;
          }

          rootNode = rootNode.parent;
      }

      var dump = Editor.getAnimationNodeDump(rootNode, node);
      return dump;
    },

    recordNodeChanged (idsOrNodes) {
      if (!idsOrNodes || !idsOrNodes.length) {
        return;
      }

      var nodes = idsOrNodes;
      if (typeof nodes[0] === 'string') {
        nodes = nodes.map(id => {
          return cc.engine.getInstanceById(id);
        });
      }

      var infos = nodes.map(node => {
        return {
          id: node.uuid,
          dump: Editor.getNodeDump(node)
        };
      });

      Editor.sendToWindows('editor:record-node-changed', infos);
    }
  };

  _Scene.AnimUtils = AnimUtils;

})();
