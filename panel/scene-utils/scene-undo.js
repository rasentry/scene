'use strict';

/**
 * info = {
 *   before: [{id, data}],
 *   after: [{id, data}],
 * }
 */
class RecordObjectsCommand extends Editor.Undo.Command {
  undo () {
    let nodeIDs = [];
    for ( let i = this.info.before.length-1; i >= 0; --i ) {
      let objInfo = this.info.before[i];
      let obj = cc.engine.getInstanceById(objInfo.id);

      try {
        Editor._restoreObject( obj, objInfo.data );

        //
        let node = null;
        if ( obj instanceof cc.Node ) {
          node = obj;
        } else if ( obj instanceof cc.Component ) {
          node = obj.node;
        }

        //
        if ( node && nodeIDs.indexOf( node.uuid ) === -1 ) {
          nodeIDs.push( node.uuid );
        }

        Editor.Selection.select( 'node', nodeIDs );
      } catch ( err ) {
        Editor.error(`Failed to restore object ${obj._name}: ${err}`);
      }
    }
  }

  redo () {
    let nodeIDs = [];
    for ( let i = 0; i < this.info.after.length; ++i ) {
      let objInfo = this.info.after[i];
      let obj = cc.engine.getInstanceById(objInfo.id);

      try {
        Editor._restoreObject( obj, objInfo.data );

        //
        let node = null;
        if ( obj instanceof cc.Node ) {
          node = obj;
        } else if ( obj instanceof cc.Component ) {
          node = obj.node;
        }

        //
        if ( node && nodeIDs.indexOf( node.uuid ) === -1 ) {
          nodeIDs.push( node.uuid );
        }

        Editor.Selection.select( 'node', nodeIDs );
      } catch ( err ) {
        Editor.error(`Failed to restore object ${obj._name}: ${err}`);
      }
    }
  }
}

/**
 * info = {
 *   list: [{node, parent, siblingIndex}]
 * }
 */
class CreateNodesCommand extends Editor.Undo.Command {
  undo () {
    let nodeIDs = [];
    for ( let i = this.info.list.length-1; i >= 0; --i ) {
      let info = this.info.list[i];

      info.node._destroyForUndo(() => {
        info.data = Editor._recordDeleteNode(info.node);
      });
      nodeIDs.push(info.node.uuid);
    }
    Editor.Selection.unselect('node', nodeIDs);
  }

  redo () {
    let nodeIDs = [];
    for ( let i = 0; i < this.info.list.length; ++i ) {
      let info = this.info.list[i];

      try {
        Editor._restoreDeleteNode( info.node, info.data );
        nodeIDs.push(info.node.uuid);
      } catch ( err ) {
        Editor.error(`Failed to restore delete node ${info.node._name}: ${err}`);
      }
    }
    Editor.Selection.select('node', nodeIDs);
  }
}

/**
 * info = {
 *   list: [{node, parent, siblingIndex}]
 * }
 */
class DeleteNodesCommand extends Editor.Undo.Command {
  undo () {
    let nodeIDs = [];
    for ( let i = this.info.list.length-1; i >= 0; --i ) {
      let info = this.info.list[i];

      try {
        Editor._restoreDeleteNode( info.node, info.data );
        nodeIDs.push(info.node.uuid);
      } catch ( err ) {
        Editor.error(`Failed to restore delete node ${info.node._name}: ${err}`);
      }
    }
    Editor.Selection.select('node', nodeIDs);
  }

  redo () {
    let nodeIDs = [];
    for ( let i = 0; i < this.info.list.length; ++i ) {
      let info = this.info.list[i];

      info.node._destroyForUndo(() => {
        info.data = Editor._recordDeleteNode(info.node);
      });
      nodeIDs.push(info.node.uuid);
    }
    Editor.Selection.unselect('node', nodeIDs);
  }
}

/**
 * info = {
 *   list: [{node, parent, siblingIndex}]
 * }
 */
class MoveNodesCommand extends Editor.Undo.Command {
  static moveNode ( node, parent, siblingIndex ) {
    if (node.parent !== parent) {
      // keep world transform not changed
      var worldPos = node.worldPosition;
      var worldRotation = node.worldRotation;
      var lossyScale = node.worldScale;

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
    }

    node.setSiblingIndex(siblingIndex);
  }

  undo () {
    let nodeIDs = [];
    for ( let i = this.info.before.length-1; i >= 0; --i ) {
      let info = this.info.before[i];

      MoveNodesCommand.moveNode(info.node, info.parent, info.siblingIndex);
      nodeIDs.push(info.node.uuid);
    }
    Editor.Selection.select('node', nodeIDs);
  }

  redo () {
    let nodeIDs = [];
    for ( let i = 0; i < this.info.after.length; ++i ) {
      let info = this.info.after[i];

      MoveNodesCommand.moveNode(info.node, info.parent, info.siblingIndex);
      nodeIDs.push(info.node.uuid);
    }
    Editor.Selection.select('node', nodeIDs);
  }
}

/**
 * info = {
 *   list: [{id, comp, index, data}]
 * }
 */
class AddComponentCommand extends Editor.Undo.Command {
  undo () {
    let node = cc.engine.getInstanceById(this.info.id);
    if ( !node ) {
      return;
    }

    this.info.comp._destroyForUndo(() => {
      this.info.data = Editor._recordObject(this.info.comp);
    });
    Editor.Selection.select('node', node.uuid);
  }

  redo () {
    let node = cc.engine.getInstanceById(this.info.id);
    if ( !node ) {
      return;
    }

    try {
      Editor._restoreObject( this.info.comp, this.info.data );
      Editor._renewObject( this.info.comp );

      node._addComponentAt( this.info.comp, this.info.index );
    } catch ( err ) {
      Editor.error(`Failed to restore component at node ${this.info.node.name}: ${err}`);
    }
    Editor.Selection.select('node', node.uuid);
  }
}

/**
 * info = {
 *   list: [{id, comp, index, data}]
 * }
 */
class RemoveComponentCommand extends Editor.Undo.Command {
  undo () {
    let node = cc.engine.getInstanceById(this.info.id);
    if ( !node ) {
      return;
    }

    try {
      Editor._restoreObject( this.info.comp, this.info.data );
      Editor._renewObject( this.info.comp );

      node._addComponentAt( this.info.comp, this.info.index );
    } catch ( err ) {
      Editor.error(`Failed to restore component at node ${this.info.node.name}: ${err}`);
    }
    Editor.Selection.select('node', node.uuid);
  }

  redo () {
    let node = cc.engine.getInstanceById(this.info.id);
    if ( !node ) {
      return;
    }

    this.info.comp._destroyForUndo(() => {
      this.info.data = Editor._recordObject(this.info.comp);
    });
    Editor.Selection.select('node', node.uuid);
  }
}

/**
 * SceneUndo
 */

let _currentCreatedRecords = [];
let _currentDeletedRecords = [];
let _currentMovedRecords = [];
let _currentObjectRecords = [];
let _undo = Editor.Undo.local();

let SceneUndo = {
  init () {
    _undo.register( 'record-objects', RecordObjectsCommand );
    _undo.register( 'create-nodes', CreateNodesCommand );
    _undo.register( 'delete-nodes', DeleteNodesCommand );
    _undo.register( 'move-nodes', MoveNodesCommand );
    _undo.register( 'add-component', AddComponentCommand );
    _undo.register( 'remove-component', RemoveComponentCommand );

    _currentCreatedRecords = [];
    _currentDeletedRecords = [];
    _currentMovedRecords = [];
    _currentObjectRecords = [];
  },

  clear () {
    _currentCreatedRecords = [];
    _currentDeletedRecords = [];
    _currentMovedRecords = [];
    _currentObjectRecords = [];

    _undo.clear();
  },

  recordObject ( id, desc ) {
    if ( desc ) {
      _undo.setCurrentDescription(desc);
    }

    // only record object if it has not recorded yet
    let exists = _currentObjectRecords.some( record => {
      return record.id === id;
    });
    if ( !exists ) {
      let obj = cc.engine.getInstanceById(id);
      try {
        let data = Editor._recordObject(obj);

        _currentObjectRecords.push({
          id: id,
          data: data,
        });
      } catch ( err ) {
        Editor.error(`Failed to record object ${obj._name}: ${err}`);
      }
    }
  },

  recordCreateNode ( id, desc ) {
    if ( desc ) {
      _undo.setCurrentDescription(desc);
    }

    // only record object if it has not recorded yet
    let exists = _currentCreatedRecords.some(record => {
      return record.node.id === id;
    });
    if ( !exists ) {
      let node = cc.engine.getInstanceById(id);
      _currentCreatedRecords.push({
        node: node,
        parent: node.parent,
        siblingIndex: node.getSiblingIndex(),
      });
    }
  },

  recordDeleteNode ( id, desc ) {
    if ( desc ) {
      _undo.setCurrentDescription(desc);
    }

    // only record object if it has not recorded yet
    let exists = _currentDeletedRecords.some(record => {
      return record.node.id === id;
    });
    if ( !exists ) {
      let node = cc.engine.getInstanceById(id);

      try {
        _currentDeletedRecords.push({
          node: node,
          data: Editor._recordDeleteNode(node),
        });
      } catch ( err ) {
        Editor.error(`Failed to record delete node ${node._name}: ${err}`);
      }
    }
  },

  recordMoveNode ( id, desc ) {
    if ( desc ) {
      _undo.setCurrentDescription(desc);
    }

    // only record object if it has not recorded yet
    let exists = _currentMovedRecords.some(record => {
      return record.node.id === id;
    });
    if ( !exists ) {
      let node = cc.engine.getInstanceById(id);
      _currentMovedRecords.push({
        node: node,
        parent: node.parent,
        siblingIndex: node.getSiblingIndex(),
      });
    }
  },

  recordAddComponent ( id, comp, index, desc ) {
    if ( desc ) {
      _undo.setCurrentDescription(desc);
    }

    _undo.add('add-component', {
      id: id,
      comp: comp,
      index: index,
    });
  },

  recordRemoveComponent ( id, comp, index, desc ) {
    if ( desc ) {
      _undo.setCurrentDescription(desc);
    }

    _undo.add('remove-component', {
      id: id,
      comp: comp,
      index: index,
      data: Editor._recordObject(comp),
    });
  },

  commit () {
    // flush created records
    if ( _currentCreatedRecords.length ) {
      _undo.add('create-nodes', {
        list: _currentCreatedRecords
      });

      _currentCreatedRecords = [];
    }

    // flush records
    if ( _currentObjectRecords.length ) {
      try {
        let beforeList = _currentObjectRecords;
        let afterList = _currentObjectRecords.map( record => {
          let obj = cc.engine.getInstanceById(record.id);
          return {
            id: record.id,
            data: Editor._recordObject(obj),
          };
        });

        _undo.add('record-objects', {
          before: beforeList,
          after: afterList,
        });
      } catch ( err ) {
        Editor.error(`Failed to add record objects to undo list: ${err}`);
      }

      _currentObjectRecords = [];
    }

    // flush move records
    if ( _currentMovedRecords.length ) {
      let beforeList = _currentMovedRecords;
      let afterList = _currentMovedRecords.map( record => {
        return {
          node: record.node,
          parent: record.node.parent,
          siblingIndex: record.node.getSiblingIndex(),
        };
      });

      _undo.add('move-nodes', {
        before: beforeList,
        after: afterList,
      });

      _currentMovedRecords = [];
    }

    // flush deleted records
    if ( _currentDeletedRecords.length ) {
      _undo.add('delete-nodes', {
        list: _currentDeletedRecords
      });

      _currentDeletedRecords = [];
    }

    //
    _undo.commit();
  },

  cancel () {
    _currentCreatedRecords = [];
    _currentDeletedRecords = [];
    _currentMovedRecords = [];
    _currentObjectRecords = [];

    //
    _undo.cancel();
  },

  undo () {
    _undo.undo();
    cc.engine.repaintInEditMode();
  },

  redo () {
    _undo.redo();
    cc.engine.repaintInEditMode();
  },

  save () {
    _undo.save();
  },

  dirty () {
    return _undo.dirty();
  },

  on () {
    _undo.on.apply( _undo, arguments );
  },
};

_Scene.Undo = SceneUndo;
