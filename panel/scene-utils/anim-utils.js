'use strict';

(() => {
  let AnimUtils = {
    _recording: false,
    _recordingData: null,

    curRootNode: null,
    curEditNode: null,
    curAnim: null,
    curAnimState: null,
    curTime: -1,

    isPlaying() {
      if (!this.curAnimState) return false;
      return this.curAnimState.isPlaying;
    },

    setAnimationTime(info) {
      var anim = this.curAnim;
      var aniState = this.curAnimState;

      if (!anim || !aniState) {
        return;
      }

      var clipName = info.clip;

      if (!aniState.isPlaying) {
        anim.play(clipName);
        anim.pause(clipName);
      }

      var time = info.time;
      this.curTime = time;

      if (time > aniState.duration) {
        time = aniState.duration;
      }

      anim.setCurrentTime(time, clipName);
      anim.sample();

      cc.engine.repaintInEditMode();
    },

    getAnimationTime: function (info) {
      var aniState = this.curAnimState;

      if (!aniState) {
        return;
      }

      var wrappedInfo = aniState.getWrappedInfo(aniState.time);

      return {
        clip: info.clip,
        time: wrappedInfo.time,
        isPlaying: aniState.isPlaying
      };
    },

    setCurrentPlayState: function (info) {
      var anim = this.curAnim;
      var aniState = this.curAnimState;

      if (!anim || !aniState) {
        return;
      }

      var state = info.state;
      var clipName = info.clip;

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
      var node = this.curEditNode;
      if (!node) {
        return;
      }

      cc.AssetLibrary.loadAsset(info.clipUuid, function (err, clip) {
        var anim = node.getComponent(cc.Animation);
        anim.addClip(clip);
      });
    },

    updateClip(info) {
      var anim = this.curAnim;
      if (!anim) return;

      cc.AssetLibrary.loadJson(info.data, function (err, clip) {
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

      var curRootNode = this.curRootNode;
      if (!curRootNode) return;

      var anim = this.curAnim = curRootNode.getComponent(cc.Animation);
      var clipName = info.clip;

      this.curAnimState = anim.getAnimationState(clipName);
      anim.play(clipName);
      anim.pause(clipName);
    },

    // trajectory

    showTrajectoryGizmo(info) {
      var gizmosView = _Scene.gizmosView;
      var curRootNode = this.curRootNode;

      if (!curRootNode) {
        return;
      }

      cc.AssetLibrary.loadAsset(info.clipUuid, function (err, clip) {
          for (var i = 0; i < info.nodeIds.length; i++) {
              var node = cc.engine.getInstanceById(info.nodeIds[i]);
              if (!node) continue;

              if (!node.trajectoryGizmo) {
                  node.trajectoryGizmo = new Editor.gizmos.trajectory(gizmosView, node);
              }
              node.trajectoryGizmo.show(curRootNode, clip, info.childPaths[i]);
          }
      });
    },

    hideTrajectoryGizmo(info) {
      for (var i = 0; i < info.nodeIds.length; i++) {
          var node = cc.engine.getInstanceById(info.nodeIds[i]);
          if (node && node.trajectoryGizmo) {
              node.trajectoryGizmo.hide();
          }
      }
    },

    // selection

    activate(node) {
      this.curEditNode = node;
      this.curRootNode = null;

      var animationNode = node;
      var isAnimationNode = animationNode.getComponent(cc.Animation);

      while (animationNode && !(animationNode instanceof cc.Scene)) {
        isAnimationNode = animationNode.getComponent(cc.Animation);
        if (isAnimationNode) {
          this.curRootNode = animationNode;
          break;
        }

        animationNode = animationNode.parent;
      }
    },

    deactivate(node) {
      if (this.curEditNode !== node) {
        return;
      }

      this.curRootNode = null;
      this.curEditNode = null;
    }
  };

  _Scene.AnimUtils = AnimUtils;

})();
